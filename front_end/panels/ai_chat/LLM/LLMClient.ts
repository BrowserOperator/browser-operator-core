// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { LLMMessage, LLMResponse, LLMCallOptions, LLMProvider, ModelInfo, RetryConfig } from './LLMTypes.js';
import { isCustomProvider } from './LLMTypes.js';
import { LLMProviderRegistry } from './LLMProviderRegistry.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { LiteLLMProvider } from './LiteLLMProvider.js';
import { GroqProvider } from './GroqProvider.js';
import { OpenRouterProvider } from './OpenRouterProvider.js';
import { BrowserOperatorProvider } from './BrowserOperatorProvider.js';
import { CerebrasProvider } from './CerebrasProvider.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import { GoogleAIProvider } from './GoogleAIProvider.js';
import { GenericOpenAIProvider } from './GenericOpenAIProvider.js';
import { CustomProviderManager } from '../core/CustomProviderManager.js';
import { LLMResponseParser } from './LLMResponseParser.js';
import { createLogger } from '../core/Logger.js';
import { getCurrentTracingContext } from '../tracing/TracingConfig.js';

const logger = createLogger('LLMClient');

/**
 * Configuration for individual LLM providers
 */
export interface LLMProviderConfig {
  provider: string; // Can be LLMProvider or custom provider ID (e.g., "custom:my-provider")
  apiKey: string;
  providerURL?: string; // Optional: for LiteLLM endpoint or custom OpenAI endpoint
}

/**
 * Configuration for the LLM client
 */
export interface LLMClientConfig {
  providers: LLMProviderConfig[];
}

/**
 * Request structure for LLM calls
 */
export interface LLMCallRequest {
  provider: LLMProvider;
  model: string;
  messages: LLMMessage[];
  systemPrompt: string;
  tools?: any[];
  temperature?: number;
  retryConfig?: Partial<RetryConfig>;
  agentName?: string; // Name of the calling agent for provider-specific routing
  tracingMetadata?: Record<string, any>; // Explicit tracing metadata for Langfuse integration
}

/**
 * Main LLM client coordinator that provides a unified interface for agents
 * Replaces UnifiedLLMClient with cleaner architecture
 */
export class LLMClient {
  private static instance: LLMClient | null = null;
  private initialized = false;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): LLMClient {
    if (!LLMClient.instance) {
      LLMClient.instance = new LLMClient();
    }
    return LLMClient.instance;
  }

  /**
   * Initialize the LLM client with provider configurations
   */
  async initialize(config: LLMClientConfig): Promise<void> {
    logger.info('Initializing LLM client with providers:', config.providers.map(p => p.provider));

    // Clear existing providers
    LLMProviderRegistry.clear();

    // Register providers based on configuration
    for (const providerConfig of config.providers) {
      try {
        let providerInstance;

        switch (providerConfig.provider) {
          case 'openai':
            providerInstance = new OpenAIProvider(providerConfig.apiKey);
            break;
          case 'litellm':
            providerInstance = new LiteLLMProvider(
              providerConfig.apiKey,
              providerConfig.providerURL
            );
            break;
          case 'groq':
            providerInstance = new GroqProvider(providerConfig.apiKey);
            break;
          case 'openrouter':
            providerInstance = new OpenRouterProvider(providerConfig.apiKey);
            break;
          case 'browseroperator':
            providerInstance = new BrowserOperatorProvider(
              providerConfig.apiKey || null,
              providerConfig.providerURL  // Optional override for testing
            );
            break;
          case 'cerebras':
            providerInstance = new CerebrasProvider(providerConfig.apiKey);
            break;
          case 'anthropic':
            providerInstance = new AnthropicProvider(providerConfig.apiKey);
            break;
          case 'googleai':
            providerInstance = new GoogleAIProvider(providerConfig.apiKey);
            break;
          default:
            logger.warn(`Unknown provider type: ${providerConfig.provider}`);
            continue;
        }

        LLMProviderRegistry.registerProvider(providerConfig.provider, providerInstance);
        logger.info(`Registered ${providerConfig.provider} provider`);
      } catch (error) {
        logger.error(`Failed to initialize ${providerConfig.provider} provider:`, error);
      }
    }

    // Load and register custom providers
    try {
      const customProviders = CustomProviderManager.listEnabledProviders();
      logger.info(`Loading ${customProviders.length} custom providers`);

      for (const customProviderConfig of customProviders) {
        try {
          const apiKey = CustomProviderManager.getApiKey(customProviderConfig.id);
          const providerInstance = new GenericOpenAIProvider(
            customProviderConfig,
            apiKey || undefined
          );
          LLMProviderRegistry.registerProvider(
            customProviderConfig.id as LLMProvider,
            providerInstance
          );
          logger.info(`Registered custom provider: ${customProviderConfig.name} (${customProviderConfig.id})`);
        } catch (error) {
          logger.error(`Failed to initialize custom provider ${customProviderConfig.name}:`, error);
        }
      }
    } catch (error) {
      logger.error('Failed to load custom providers:', error);
    }

    this.initialized = true;
    logger.info('LLM client initialization complete');
  }

  /**
   * Check if the client is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('LLMClient must be initialized before use. Call initialize() first.');
    }
  }

  /**
   * Main method for LLM calls with request object
   */
  async call(request: LLMCallRequest): Promise<LLMResponse> {
    this.ensureInitialized();

    const provider = LLMProviderRegistry.getProvider(request.provider);

    if (!provider) {
      throw new Error(`Provider ${request.provider} not available. Available providers: ${LLMProviderRegistry.getRegisteredProviders().join(', ')}`);
    }

    logger.debug(`Using ${request.provider} provider for model ${request.model}`);

    // Build messages array with required system prompt
    let messages = [...request.messages];

    // Add system prompt - always required
    const hasSystemMessage = messages.some(msg => msg.role === 'system');
    if (!hasSystemMessage) {
      messages.unshift({
        role: 'system',
        content: request.systemPrompt
      });
    }

    // Build options
    const options: LLMCallOptions = {};
    if (request.temperature !== undefined) {
      options.temperature = request.temperature;
    }
    if (request.tools) {
      options.tools = request.tools;
    }
    if (request.retryConfig) {
      options.retryConfig = request.retryConfig;
    }
    // Forward agent name for provider-specific routing
    if ((request as any).agentName) {
      options.agentName = (request as any).agentName;
    }

    // Get tracing metadata - prefer explicit request metadata over global context
    // This ensures metadata flows correctly even when async context is lost
    let tracingMetadata = request.tracingMetadata;

    if (!tracingMetadata || Object.keys(tracingMetadata).length === 0) {
      // Fall back to global tracing context
      const tracingContext = getCurrentTracingContext();
      logger.info('LLMClient.call() - Checking tracing context (fallback):', {
        hasContext: !!tracingContext,
        hasMetadata: !!tracingContext?.metadata,
        metadataKeys: tracingContext?.metadata ? Object.keys(tracingContext.metadata) : [],
        sessionId: tracingContext?.metadata?.session_id,
        traceId: tracingContext?.metadata?.trace_id
      });
      if (tracingContext?.metadata && Object.keys(tracingContext.metadata).length > 0) {
        tracingMetadata = tracingContext.metadata;
      }
    } else {
      logger.info('LLMClient.call() - Using explicit tracingMetadata from request:', {
        metadataKeys: Object.keys(tracingMetadata),
        sessionId: tracingMetadata.session_id,
        traceId: tracingMetadata.trace_id
      });
    }

    if (tracingMetadata && Object.keys(tracingMetadata).length > 0) {
      options.tracingMetadata = tracingMetadata;
      logger.info('Passing tracing metadata to provider:', tracingMetadata);
    } else {
      logger.info('No tracing metadata available');
    }

    return provider.callWithMessages(request.model, messages, options);
  }


  /**
   * Parse response into standardized action structure
   */
  parseResponse(response: LLMResponse): ReturnType<typeof LLMResponseParser.parseResponse> {
    return LLMResponseParser.parseResponse(response);
  }

  /**
   * Get all available models from all providers
   */
  async getAvailableModels(): Promise<ModelInfo[]> {
    this.ensureInitialized();
    return LLMProviderRegistry.getAllModels();
  }

  /**
   * Get models for a specific provider
   */
  async getModelsByProvider(provider: LLMProvider): Promise<ModelInfo[]> {
    this.ensureInitialized();
    return LLMProviderRegistry.getModelsByProvider(provider);
  }

  /**
   * Test connection to a specific model
   */
  async testConnection(provider: LLMProvider, modelId: string): Promise<{success: boolean, message: string}> {
    this.ensureInitialized();

    const providerInstance = LLMProviderRegistry.getProvider(provider);

    if (!providerInstance) {
      return {
        success: false,
        message: `Provider ${provider} not available`
      };
    }

    if (providerInstance.testConnection) {
      return providerInstance.testConnection(modelId);
    }

    // Fallback test: simple call
    try {
      const response = await this.call({
        provider,
        model: modelId,
        messages: [{ role: 'user', content: 'Please respond with "OK" to test the connection.' }],
        systemPrompt: 'You are a helpful assistant for testing purposes.',
        temperature: 0.1
      });

      return {
        success: true,
        message: `Connected successfully. Response: ${response.text || 'No text response'}`
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Refresh models for a specific provider or all providers
   */
  async refreshProviderModels(provider?: LLMProvider): Promise<void> {
    this.ensureInitialized();

    if (provider) {
      const providerInstance = LLMProviderRegistry.getProvider(provider);
      if (providerInstance) {
        try {
          await providerInstance.getModels();
          logger.info(`Refreshed models for ${provider} provider`);
        } catch (error) {
          logger.error(`Failed to refresh models for ${provider}:`, error);
        }
      }
    } else {
      // Refresh all providers
      const providers = LLMProviderRegistry.getRegisteredProviders();
      for (const providerType of providers) {
        await this.refreshProviderModels(providerType);
      }
    }
  }

  /**
   * Register a custom model with the LiteLLM provider
   */
  registerCustomModel(modelId: string, name?: string): ModelInfo {
    const modelInfo: ModelInfo = {
      id: modelId,
      name: name || modelId,
      provider: 'litellm',
      capabilities: {
        functionCalling: true,
        reasoning: false,
        vision: false,
        structured: true
      }
    };

    // Save to localStorage for LiteLLM provider to pick up
    try {
      const existingModels = JSON.parse(localStorage.getItem('ai_chat_custom_models') || '[]');
      const updatedModels = [...existingModels, modelInfo];
      localStorage.setItem('ai_chat_custom_models', JSON.stringify(updatedModels));
      logger.info(`Registered custom model: ${modelId}`);
    } catch (error) {
      logger.error('Failed to save custom model to localStorage:', error);
    }

    return modelInfo;
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    initialized: boolean;
    providersCount: number;
    providers: LLMProvider[];
  } {
    const registryStats = LLMProviderRegistry.getStats();
    return {
      initialized: this.initialized,
      ...registryStats
    };
  }

  /**
   * Static method to fetch models from LiteLLM endpoint (for UI use without initialization)
   */
  static async fetchLiteLLMModels(apiKey: string | null, baseUrl?: string): Promise<any[]> {
    return LLMProviderRegistry.fetchProviderModels('litellm', apiKey || '', baseUrl);
  }

  /**
   * Static method to test LiteLLM connection (for UI use without initialization)
   */
  static async testLiteLLMConnection(apiKey: string | null, modelName: string, baseUrl?: string): Promise<{success: boolean, message: string}> {
    return LLMProviderRegistry.testProviderConnection('litellm', apiKey || '', baseUrl);
  }

  /**
   * Static method to fetch models from Groq API (for UI use without initialization)
   */
  static async fetchGroqModels(apiKey: string): Promise<any[]> {
    return LLMProviderRegistry.fetchProviderModels('groq', apiKey);
  }

  /**
   * Static method to test Groq connection (for UI use without initialization)
   */
  static async testGroqConnection(apiKey: string, modelName: string): Promise<{success: boolean, message: string}> {
    return LLMProviderRegistry.testProviderConnection('groq', apiKey);
  }

  /**
   * Static method to fetch models from OpenRouter API (for UI use without initialization)
   */
  static async fetchOpenRouterModels(apiKey: string): Promise<any[]> {
    return LLMProviderRegistry.fetchProviderModels('openrouter', apiKey);
  }

  /**
   * Static method to test OpenRouter connection (for UI use without initialization)
   */
  static async testOpenRouterConnection(apiKey: string, modelName: string): Promise<{success: boolean, message: string}> {
    return LLMProviderRegistry.testProviderConnection('openrouter', apiKey);
  }

  /**
   * Static method to test BrowserOperator connection (for UI use without initialization)
   */
  static async testBrowserOperatorConnection(endpoint: string): Promise<{success: boolean, message: string}> {
    try {
      const healthUrl = endpoint.replace(/\/v1\/?$/, '') + '/health';
      const response = await fetch(healthUrl);

      if (!response.ok) {
        return {
          success: false,
          message: `Health check failed: ${response.statusText}`
        };
      }

      const data = await response.json();
      return {
        success: true,
        message: `Connected to BrowserOperator API server. Status: ${data.status}`
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Static method to fetch models from Cerebras API (for UI use without initialization)
   */
  static async fetchCerebrasModels(apiKey: string): Promise<any[]> {
    return LLMProviderRegistry.fetchProviderModels('cerebras', apiKey);
  }

  /**
   * Static method to test Cerebras connection (for UI use without initialization)
   */
  static async testCerebrasConnection(apiKey: string, modelName: string): Promise<{success: boolean, message: string}> {
    return LLMProviderRegistry.testProviderConnection('cerebras', apiKey);
  }

  /**
   * Static method to fetch models from Anthropic API (for UI use without initialization)
   */
  static async fetchAnthropicModels(apiKey: string): Promise<any[]> {
    return LLMProviderRegistry.fetchProviderModels('anthropic', apiKey);
  }

  /**
   * Static method to test Anthropic connection (for UI use without initialization)
   */
  static async testAnthropicConnection(apiKey: string, modelName: string): Promise<{success: boolean, message: string}> {
    return LLMProviderRegistry.testProviderConnection('anthropic', apiKey);
  }

  /**
   * Static method to fetch models from Google AI API (for UI use without initialization)
   */
  static async fetchGoogleAIModels(apiKey: string): Promise<any[]> {
    return LLMProviderRegistry.fetchProviderModels('googleai', apiKey);
  }

  /**
   * Static method to test Google AI connection (for UI use without initialization)
   */
  static async testGoogleAIConnection(apiKey: string, modelName: string): Promise<{success: boolean, message: string}> {
    return LLMProviderRegistry.testProviderConnection('googleai', apiKey);
  }

  /**
   * Static method to validate credentials for a specific provider
   */
  static validateProviderCredentials(providerType: string): {isValid: boolean, message: string, missingItems?: string[]} {
    try {
      // Check if it's a custom provider
      if (isCustomProvider(providerType)) {
        // Validate that the custom provider exists
        const customProvider = CustomProviderManager.getProvider(providerType);
        if (!customProvider) {
          return {
            isValid: false,
            message: 'Custom provider not found',
            missingItems: ['Provider']
          };
        }

        // Validate that it has models configured
        if (!customProvider.models || customProvider.models.length === 0) {
          return {
            isValid: false,
            message: 'No models configured for this provider',
            missingItems: ['Models']
          };
        }

        // Validate that it's enabled
        if (!customProvider.enabled) {
          return {
            isValid: false,
            message: 'Provider is disabled',
            missingItems: ['Enabled status']
          };
        }

        return {
          isValid: true,
          message: 'Custom provider configuration valid'
        };
      }

      // Delegate to LLMProviderRegistry for standard providers
      return LLMProviderRegistry.validateProviderCredentials(providerType as LLMProvider);
    } catch (error) {
      return {
        isValid: false,
        message: `Failed to validate ${providerType} credentials: ${error instanceof Error ? error.message : String(error)}`,
        missingItems: ['Provider configuration']
      };
    }
  }

  /**
   * Static method to get provider credentials from localStorage
   * Combines validation and credential retrieval in one call
   * @param providerType The provider type
   * @returns Object with canProceed flag, apiKey, and optional endpoint
   */
  static getProviderCredentials(providerType: string): {
    canProceed: boolean;
    apiKey: string | null;
    endpoint?: string | null;
    storageKeys?: {apiKey?: string; endpoint?: string; [key: string]: string | undefined};
  } {
    try {
      // Check if it's a custom provider
      if (isCustomProvider(providerType)) {
        // Validate the custom provider first
        const validation = LLMClient.validateProviderCredentials(providerType);
        if (!validation.isValid) {
          return {
            canProceed: false,
            apiKey: null
          };
        }

        // Get API key and storage key from CustomProviderManager
        const apiKey = CustomProviderManager.getApiKey(providerType);
        const apiKeyStorageKey = CustomProviderManager.getApiKeyStorageKey(providerType);

        return {
          canProceed: true,
          apiKey,
          storageKeys: {
            apiKey: apiKeyStorageKey
          }
        };
      }

      // Delegate to LLMProviderRegistry for standard providers
      return LLMProviderRegistry.getProviderCredentials(providerType as LLMProvider);
    } catch (error) {
      logger.error(`Failed to get credentials for ${providerType}:`, error);
      return {
        canProceed: false,
        apiKey: null
      };
    }
  }

  /**
   * Static method to test custom provider connection and fetch models
   */
  static async testCustomProviderConnection(
    name: string,
    baseURL: string,
    apiKey?: string
  ): Promise<{success: boolean, message: string, models?: string[]}> {
    try {
      // Create a temporary custom provider config
      const tempConfig = {
        id: `custom:${name.toLowerCase().replace(/\s+/g, '-')}`,
        name,
        baseURL,
        models: [],
        enabled: true
      };

      // Create a temporary GenericOpenAIProvider instance
      const provider = new GenericOpenAIProvider(tempConfig, apiKey);

      // Test connection by fetching models
      const modelObjects = await provider.fetchModels();

      if (modelObjects && modelObjects.length > 0) {
        // Extract model IDs from model objects
        const modelIds = modelObjects.map(model => model.id);
        return {
          success: true,
          message: `Successfully connected to ${name}. Found ${modelIds.length} models.`,
          models: modelIds
        };
      } else {
        return {
          success: false,
          message: 'Connection successful but no models found'
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

}