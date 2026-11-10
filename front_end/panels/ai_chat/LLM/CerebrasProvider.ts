// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { LLMMessage, LLMResponse, LLMCallOptions, LLMProvider, ModelInfo } from './LLMTypes.js';
import { LLMBaseProvider } from './LLMProvider.js';
import { LLMRetryManager } from './LLMErrorHandler.js';
import { LLMResponseParser } from './LLMResponseParser.js';
import { createLogger } from '../core/Logger.js';

const logger = createLogger('CerebrasProvider');

/**
 * Cerebras model information
 */
export interface CerebrasModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface CerebrasModelsResponse {
  object: string;
  data: CerebrasModel[];
}

/**
 * Cerebras provider implementation using OpenAI-compatible Chat Completions API
 * https://inference-docs.cerebras.ai/api-reference/chat-completions
 */
export class CerebrasProvider extends LLMBaseProvider {
  private static readonly API_BASE_URL = 'https://api.cerebras.ai/v1';
  private static readonly CHAT_COMPLETIONS_PATH = '/chat/completions';
  private static readonly MODELS_PATH = '/models';

  readonly name: LLMProvider = 'cerebras';

  constructor(private readonly apiKey: string) {
    super();
  }

  /**
   * Get the chat completions endpoint URL
   */
  private getChatEndpoint(): string {
    return `${CerebrasProvider.API_BASE_URL}${CerebrasProvider.CHAT_COMPLETIONS_PATH}`;
  }

  /**
   * Get the models endpoint URL
   */
  private getModelsEndpoint(): string {
    return `${CerebrasProvider.API_BASE_URL}${CerebrasProvider.MODELS_PATH}`;
  }

  /**
   * Converts LLMMessage format to Cerebras/OpenAI format
   */
  private convertMessagesToCerebras(messages: LLMMessage[]): any[] {
    return messages.map(msg => {
      const baseMessage: any = {
        role: msg.role,
        content: msg.content
      };

      // Ensure tool call arguments are strings per OpenAI/Cerebras spec
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        baseMessage.tool_calls = msg.tool_calls.map(tc => {
          const args = (tc.function as any).arguments;
          const argsString = typeof args === 'string' ? args : JSON.stringify(args ?? {});
          return {
            ...tc,
            function: {
              ...tc.function,
              arguments: argsString,
            },
          };
        });
      }

      // Add optional fields if present
      if (msg.tool_call_id) {
        baseMessage.tool_call_id = msg.tool_call_id;
      }
      if (msg.name) {
        baseMessage.name = msg.name;
      }

      // For tool role, content must be a string; stringify objects/arrays
      if (msg.role === 'tool') {
        if (typeof baseMessage.content !== 'string') {
          baseMessage.content = JSON.stringify(baseMessage.content ?? '');
        }
      }

      return baseMessage;
    });
  }

  /**
   * JSON Schema fields not supported by Cerebras API.
   * These constraints cause "Invalid fields for schema with types ['number']" errors.
   */
  private static readonly UNSUPPORTED_SCHEMA_FIELDS = new Set([
    // Number constraints
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    // String constraints
    'minLength',
    'maxLength',
    'pattern',
    // Array constraints
    'minItems',
    'maxItems',
    'uniqueItems',
    // Object constraints
    'minProperties',
    'maxProperties',
    'additionalProperties',
    // Other unsupported fields
    'format',
    'default',
    'examples',
    '$schema',
    '$id',
    '$ref',
    'const',
  ]);

  /**
   * Simplifies JSON schemas for Cerebras compatibility.
   * Cerebras has strict schema requirements:
   * - Removes complex constructs like oneOf/anyOf
   * - Strips unsupported constraints (minimum, maximum, etc.)
   * - Ensures all object types have properties defined
   */
  private simplifySchemaForCerebras(schema: any): any {
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    // Handle arrays
    if (Array.isArray(schema)) {
      return schema.map(item => this.simplifySchemaForCerebras(item));
    }

    const result: any = {};

    for (const key of Object.keys(schema)) {
      // Skip unsupported schema fields
      if (CerebrasProvider.UNSUPPORTED_SCHEMA_FIELDS.has(key)) {
        continue;
      }

      if (key === 'oneOf' || key === 'anyOf') {
        // For union types, pick the first option that has type: 'object' with properties,
        // or the first option if none match
        const options = schema[key];
        if (Array.isArray(options) && options.length > 0) {
          const objectOption = options.find((opt: any) => opt.type === 'object' && opt.properties);
          const chosen = objectOption || options[0];
          // Merge the chosen option's properties into result
          const simplified = this.simplifySchemaForCerebras(chosen);
          Object.assign(result, simplified);
        }
      } else {
        result[key] = this.simplifySchemaForCerebras(schema[key]);
      }
    }

    // Ensure object types have properties
    if (result.type === 'object' && !result.properties) {
      result.properties = {};
    }

    return result;
  }

  /**
   * Makes a request to the Cerebras API
   */
  private async makeAPIRequest(endpoint: string, payloadBody: any): Promise<any> {
    try {
      logger.debug('Making Cerebras API request to:', endpoint);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payloadBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        // Log the full error details and request info for debugging
        logger.error('Cerebras API error:', JSON.stringify(errorData, null, 2));
        logger.error('Request that caused error - keys:', Object.keys(payloadBody));
        if (payloadBody.tools) {
          logger.error('Tool schemas:', JSON.stringify(payloadBody.tools.map((t: any) => ({
            name: t.function?.name,
            parameterKeys: Object.keys(t.function?.parameters || {})
          })), null, 2));
        }
        // Extract message from either Cerebras format (errorData.message) or OpenAI format (errorData.error.message)
        const errorMessage = errorData?.message || errorData?.error?.message || 'Unknown error';
        throw new Error(`Cerebras API error: ${response.statusText} - ${errorMessage}`);
      }

      const data = await response.json();
      logger.info('Cerebras Response:', data);

      if (data.usage) {
        logger.info('Cerebras Usage:', {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        });
      }

      return data;
    } catch (error) {
      logger.error('Cerebras API request failed:', error);
      throw error;
    }
  }

  /**
   * Processes the Cerebras response and converts to LLMResponse format
   */
  private processCerebrasResponse(data: any): LLMResponse {
    const result: LLMResponse = {
      rawResponse: data
    };

    if (!data?.choices || data.choices.length === 0) {
      throw new Error('No choices in Cerebras response');
    }

    const choice = data.choices[0];
    const message = choice.message;

    if (!message) {
      throw new Error('No message in Cerebras choice');
    }

    // Check for tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];
      if (toolCall.function) {
        try {
          result.functionCall = {
            name: toolCall.function.name,
            arguments: JSON.parse(toolCall.function.arguments)
          };
        } catch (error) {
          logger.error('Error parsing function arguments:', error);
          result.functionCall = {
            name: toolCall.function.name,
            arguments: toolCall.function.arguments // Keep as string if parsing fails
          };
        }
      }
    } else if (message.content) {
      // Plain text response
      result.text = message.content.trim();
    }

    return result;
  }

  /**
   * Call the Cerebras API with messages
   */
  async callWithMessages(
    modelName: string,
    messages: LLMMessage[],
    options?: LLMCallOptions
  ): Promise<LLMResponse> {
    return LLMRetryManager.simpleRetry(async () => {
      logger.debug('Calling Cerebras with messages...', { model: modelName, messageCount: messages.length });

      // Construct payload body in OpenAI Chat Completions format
      const payloadBody: any = {
        model: modelName,
        messages: this.convertMessagesToCerebras(messages),
      };

      // Add temperature if provided (Cerebras supports 0-1.5)
      if (options?.temperature !== undefined) {
        payloadBody.temperature = Math.min(1.5, Math.max(0, options.temperature));
      }

      // Add tools if provided
      if (options?.tools) {
        // Ensure all tools have valid parameters and convert oneOf to anyOf for Cerebras
        payloadBody.tools = options.tools.map(tool => {
          if (tool.type === 'function' && tool.function) {
            const parameters = tool.function.parameters || { type: 'object', properties: {} };
            return {
              ...tool,
              function: {
                ...tool.function,
                parameters: this.simplifySchemaForCerebras(parameters)
              }
            };
          }
          return tool;
        });
      }

      // Ensure tool_choice is set to 'auto' when tools are present unless explicitly provided
      if (options?.tools && !options?.tool_choice) {
        payloadBody.tool_choice = 'auto';
      } else if (options?.tool_choice) {
        payloadBody.tool_choice = options.tool_choice;
      }

      // IMPORTANT: Cerebras does not support response_format with function calling
      // Ensure we never send response_format to avoid API errors
      delete payloadBody.response_format;

      // Log the full payload for debugging (including tool count)
      logger.info('Cerebras request payload:', {
        model: payloadBody.model,
        messageCount: payloadBody.messages?.length,
        toolCount: payloadBody.tools?.length,
        temperature: payloadBody.temperature,
        tool_choice: payloadBody.tool_choice,
        hasResponseFormat: 'response_format' in payloadBody,
        toolNames: payloadBody.tools?.map((t: any) => t.function?.name),
      });

      const data = await this.makeAPIRequest(this.getChatEndpoint(), payloadBody);
      return this.processCerebrasResponse(data);
    }, options?.retryConfig);
  }

  /**
   * Simple call method for backward compatibility
   */
  async call(
    modelName: string,
    prompt: string,
    systemPrompt: string,
    options?: LLMCallOptions
  ): Promise<LLMResponse> {
    const messages: LLMMessage[] = [];

    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt
      });
    }

    messages.push({
      role: 'user',
      content: prompt
    });

    return this.callWithMessages(modelName, messages, options);
  }

  /**
   * Parse response into standardized action structure
   */
  parseResponse(response: LLMResponse): ReturnType<typeof LLMResponseParser.parseResponse> {
    return LLMResponseParser.parseResponse(response);
  }

  /**
   * Fetch available models from Cerebras API
   * @param apiKey Optional API key to use instead of the instance's apiKey
   */
  async fetchModels(apiKey?: string): Promise<CerebrasModel[]> {
    const effectiveApiKey = apiKey || this.apiKey;
    logger.debug('Fetching available Cerebras models...', {
      receivedApiKey: apiKey ? `${apiKey.substring(0, 5)}...` : 'none',
      instanceApiKey: this.apiKey ? `${this.apiKey.substring(0, 5)}...` : 'none',
      effectiveApiKey: effectiveApiKey ? `${effectiveApiKey.substring(0, 5)}...` : 'none'
    });

    try {
      const response = await fetch(this.getModelsEndpoint(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${effectiveApiKey}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        logger.error('Cerebras models API error:', JSON.stringify(errorData, null, 2));
        throw new Error(`Cerebras models API error: ${response.statusText} - ${errorData?.error?.message || 'Unknown error'}`);
      }

      const data: CerebrasModelsResponse = await response.json();
      logger.debug('Cerebras Models Response:', data);

      if (!data?.data || !Array.isArray(data.data)) {
        throw new Error('Invalid models response format');
      }

      return data.data;
    } catch (error) {
      logger.error('Failed to fetch Cerebras models:', error);
      throw error;
    }
  }

  /**
   * Get all models supported by this provider
   */
  async getModels(): Promise<ModelInfo[]> {
    try {
      // Fetch models from Cerebras API
      const cerebrasModels = await this.fetchModels();

      return cerebrasModels.map(model => ({
        id: model.id,
        name: model.id, // Use ID as name
        provider: 'cerebras' as LLMProvider,
        capabilities: {
          functionCalling: this.modelSupportsFunctionCalling(model.id),
          reasoning: false, // Cerebras models don't have reasoning capabilities like O-series
          vision: false, // Cerebras currently doesn't support vision
          structured: true // All Cerebras models support structured output
        }
      }));
    } catch (error) {
      logger.warn('Failed to fetch models from Cerebras API, using default list:', error);

      // Return default list of known Cerebras models as fallback
      return this.getDefaultModels();
    }
  }

  /**
   * Check if a model supports function calling based on its ID
   */
  private modelSupportsFunctionCalling(modelId: string): boolean {
    // According to Cerebras docs, these models support function calling:
    const functionCallingModels = [
      'llama-3.3-70b',
      'llama-3.1-70b',
      'llama-3.1-8b',
      'qwen-3-32b'
    ];

    return functionCallingModels.some(model => modelId.includes(model));
  }

  /**
   * Get default list of known Cerebras models
   */
  private getDefaultModels(): ModelInfo[] {
    return [
      {
        id: 'llama-3.3-70b',
        name: 'Llama 3.3 70B',
        provider: 'cerebras' as LLMProvider,
        capabilities: {
          functionCalling: true,
          reasoning: false,
          vision: false,
          structured: true
        }
      },
      {
        id: 'llama-3.1-70b',
        name: 'Llama 3.1 70B',
        provider: 'cerebras' as LLMProvider,
        capabilities: {
          functionCalling: true,
          reasoning: false,
          vision: false,
          structured: true
        }
      },
      {
        id: 'llama-3.1-8b',
        name: 'Llama 3.1 8B',
        provider: 'cerebras' as LLMProvider,
        capabilities: {
          functionCalling: true,
          reasoning: false,
          vision: false,
          structured: true
        }
      },
      {
        id: 'qwen-3-32b',
        name: 'Qwen 3 32B',
        provider: 'cerebras' as LLMProvider,
        capabilities: {
          functionCalling: true,
          reasoning: false,
          vision: false,
          structured: true
        }
      }
    ];
  }

  /**
   * Test the Cerebras connection with a simple completion request
   */
  async testConnection(modelName: string): Promise<{success: boolean, message: string}> {
    logger.debug('Testing Cerebras connection...');

    try {
      const testPrompt = 'Please respond with "Connection successful!" to confirm the connection is working.';

      const response = await this.call(modelName, testPrompt, '', {
        temperature: 0.1,
      });

      if (response.text?.toLowerCase().includes('connection')) {
        return {
          success: true,
          message: `Successfully connected to Cerebras with model ${modelName}`,
        };
      }
      return {
        success: true,
        message: `Connected to Cerebras, but received unexpected response: ${response.text || 'No response'}`,
      };
    } catch (error) {
      logger.error('Cerebras connection test failed:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Validate that required credentials are available for Cerebras
   */
  validateCredentials(): {isValid: boolean, message: string, missingItems?: string[]} {
    const storageKeys = this.getCredentialStorageKeys();
    const apiKey = localStorage.getItem(storageKeys.apiKey!);

    if (!apiKey) {
      return {
        isValid: false,
        message: 'Cerebras API key is required. Please add your API key in Settings.',
        missingItems: ['API Key']
      };
    }

    return {
      isValid: true,
      message: 'Cerebras credentials are configured correctly.'
    };
  }

  /**
   * Get the storage keys this provider uses for credentials
   */
  getCredentialStorageKeys(): {apiKey: string} {
    return {
      apiKey: 'ai_chat_cerebras_api_key'
    };
  }
}
