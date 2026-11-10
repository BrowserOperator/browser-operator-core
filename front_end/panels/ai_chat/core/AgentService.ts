// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
// Cache break: 2025-09-17T22:47:00Z - Add AUTOMATED_MODE bypass for createAgentGraph API key validation

import { type ChatMessage, ChatMessageEntity, type ImageInputData, type ModelChatMessage } from '../models/ChatTypes.js';

// Detect if we're in a Node.js environment (eval runner, tests)
const isNodeEnvironment = typeof window === 'undefined' || typeof document === 'undefined';

// Lazy-loaded browser-only dependencies
let Common: typeof import('../../../core/common/common.js') | null = null;
let i18n: typeof import('../../../core/i18n/i18n.js') | null = null;
let SDK: typeof import('../../../core/sdk/sdk.js') | null = null;
let UI: typeof import('../../../ui/legacy/legacy.js') | null = null;
let browserDepsLoaded = false;

/**
 * Ensures browser dependencies (SDK, Common, i18n, UI) are loaded.
 * Returns false in Node.js environment or if loading fails.
 */
async function ensureBrowserDeps(): Promise<boolean> {
  if (isNodeEnvironment) {
    return false;
  }
  if (!browserDepsLoaded) {
    browserDepsLoaded = true;
    try {
      const [commonModule, i18nModule, sdkModule, uiModule] = await Promise.all([
        import('../../../core/common/common.js'),
        import('../../../core/i18n/i18n.js'),
        import('../../../core/sdk/sdk.js'),
        import('../../../ui/legacy/legacy.js'),
      ]);
      Common = commonModule;
      i18n = i18nModule;
      SDK = sdkModule;
      UI = uiModule;
    } catch {
      return false;
    }
  }
  return SDK !== null && Common !== null && i18n !== null && UI !== null;
}

/**
 * Stub ObjectWrapper for Node.js environment.
 * Provides the same interface as Common.ObjectWrapper.ObjectWrapper.
 */
class NodeObjectWrapperStub<T extends object = object> {
  private listeners = new Map<string, Set<(event: any) => void>>();

  addEventListener<K extends keyof T>(eventType: K, listener: (event: { data: T[K] }) => void): void {
    const key = String(eventType);
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(listener as any);
  }

  removeEventListener<K extends keyof T>(eventType: K, listener: (event: { data: T[K] }) => void): void {
    const key = String(eventType);
    this.listeners.get(key)?.delete(listener as any);
  }

  dispatchEventToListeners<K extends keyof T>(eventType: K, data: T[K]): void {
    const key = String(eventType);
    const eventListeners = this.listeners.get(key);
    if (eventListeners) {
      for (const listener of eventListeners) {
        try {
          listener({ data });
        } catch (e) {
          console.error('Error in event listener:', e);
        }
      }
    }
  }
}


import {createAgentGraph} from './Graph.js';
import { createLogger } from './Logger.js';
import { AgentDescriptorRegistry } from './AgentDescriptorRegistry.js';
import {type AgentState, createInitialState, createUserMessage} from './State.js';
import type {CompiledGraph} from './Types.js';
import { LLMClient } from '../LLM/LLMClient.js';
import { LLMProviderRegistry } from '../LLM/LLMProviderRegistry.js';
import { LLMConfigurationManager } from './LLMConfigurationManager.js';
import { CustomProviderManager } from './CustomProviderManager.js';
import { isCustomProvider } from '../LLM/LLMTypes.js';
import { createTracingProvider, getCurrentTracingContext } from '../tracing/TracingConfig.js';
import type { TracingProvider, TracingContext } from '../tracing/TracingProvider.js';
import { AgentRunnerEventBus } from '../agent_framework/AgentRunnerEventBus.js';
import { AgentRunner } from '../agent_framework/AgentRunner.js';
import type { AgentSession, AgentMessage } from '../agent_framework/AgentSessionTypes.js';
import type { LLMProvider } from '../LLM/LLMTypes.js';
import { BUILD_CONFIG } from './BuildConfig.js';
import { VisualIndicatorManager } from '../tools/VisualIndicatorTool.js';
import { ConversationManager } from '../persistence/ConversationManager.js';
import type { ConversationMetadata } from '../persistence/ConversationTypes.js';
import { ToolRegistry } from '../agent_framework/ConfigurableAgentTool.js';
import { MemoryModule } from '../memory/index.js';

// Cache break: 2025-09-17T17:54:00Z - Force rebuild with AUTOMATED_MODE bypass
const logger = createLogger('AgentService');

/**
 * Events dispatched by the agent service
 */
export enum Events {
  MESSAGES_CHANGED = 'messages-changed',
  AGENT_SESSION_STARTED = 'agent-session-started',
  AGENT_TOOL_STARTED = 'agent-tool-started',
  AGENT_TOOL_COMPLETED = 'agent-tool-completed',
  AGENT_SESSION_UPDATED = 'agent-session-updated',
  AGENT_SESSION_COMPLETED = 'agent-session-completed',
  CHILD_AGENT_STARTED = 'child-agent-started',
  CONVERSATION_CHANGED = 'conversation-changed',
  CONVERSATION_SAVED = 'conversation-saved',
}

// Type for AgentService event map
type AgentServiceEventMap = {
  [Events.MESSAGES_CHANGED]: ChatMessage[],
  [Events.AGENT_SESSION_STARTED]: AgentSession,
  [Events.AGENT_TOOL_STARTED]: { session: AgentSession, toolCall: AgentMessage },
  [Events.AGENT_TOOL_COMPLETED]: { session: AgentSession, toolResult: AgentMessage },
  [Events.AGENT_SESSION_UPDATED]: AgentSession,
  [Events.AGENT_SESSION_COMPLETED]: AgentSession,
  [Events.CHILD_AGENT_STARTED]: { parentSession: AgentSession, childAgentName: string, childSessionId: string },
  [Events.CONVERSATION_CHANGED]: string | null,
  [Events.CONVERSATION_SAVED]: string,
};

// Get base class at module load time - stub for Node.js
const AgentServiceBase: new () => NodeObjectWrapperStub<AgentServiceEventMap> = NodeObjectWrapperStub as any;

/**
 * Service for interacting with the orchestrator agent.
 * Extends NodeObjectWrapperStub in Node.js, Common.ObjectWrapper.ObjectWrapper in browser.
 */
export class AgentService extends AgentServiceBase {
  static instance: AgentService;

  #state: AgentState = createInitialState();
  #graph?: CompiledGraph;
  #apiKey: string|null = null;
  #isInitialized = false;
  /**
   * Active async generator for current execution. Set when execution starts,
   * cleared only after the final message is dispatched to listeners.
   */
  #runningGraphStatePromise?: AsyncGenerator<AgentState, AgentState, void>;
  #abortController?: AbortController;
  #executionId?: string;
  #tracingProvider!: TracingProvider;
  #sessionId: string;
  #activeAgentSessions = new Map<string, AgentSession>();
  #configManager: LLMConfigurationManager;
  #conversationManager: ConversationManager;
  #currentConversationId: string | null = null;
  #autoSaveTimeoutId?: number;
  #autoSaveDebounceMs = 1000;

  // Global registry for all active executions
  private static activeExecutions = new Map<string, AbortController>();

  /**
   * Register an abort controller for execution tracking
   */
  static registerExecution(executionId: string, controller: AbortController): void {
    AgentService.activeExecutions.set(executionId, controller);
  }

  /**
   * Unregister an execution
   */
  static unregisterExecution(executionId: string): void {
    AgentService.activeExecutions.delete(executionId);
  }

  /**
   * Abort all active executions
   */
  static abortAllExecutions(): void {
    for (const [executionId, controller] of AgentService.activeExecutions) {
      logger.info(`Aborting execution: ${executionId}`);
      controller.abort();
    }
    AgentService.activeExecutions.clear();
  }

  /**
   * Get abort controller for execution
   */
  static getExecutionController(executionId: string): AbortController | undefined {
    return AgentService.activeExecutions.get(executionId);
  }

  /**
   * Check if the agent is currently executing.
   * Returns true from when execution starts until after the final message has been
   * sent to listeners. This ensures UI can show "running" state while the response
   * is being streamed to the user, and only transitions to "stopped" after completion.
   *
   * @returns true if agent execution is in progress (including final message delivery),
   *          false if agent is idle and ready for new input
   */
  isRunning(): boolean {
    return this.#runningGraphStatePromise !== undefined;
  }

  constructor() {
    super();

    // Initialize configuration manager
    this.#configManager = LLMConfigurationManager.getInstance();

    // Initialize conversation manager
    this.#conversationManager = ConversationManager.getInstance();

    // Initialize tracing
    this.#sessionId = this.generateSessionId();
    this.#initializeTracing();

    // Initialize with a welcome message
    this.#state = createInitialState();
    this.#state.messages.push({
      entity: ChatMessageEntity.MODEL,
      action: 'final',
      answer: i18nString('welcomeMessage'),
      isFinalAnswer: true,
    });

    // Initialize AgentRunner event system
    AgentRunner.initializeEventBus();

    // Subscribe to AgentRunner events
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AgentRunnerEventBus.getInstance().addEventListener('agent-progress', this.#handleAgentProgress.bind(this) as any);

    // Initialize visual indicator system with reference to AgentService
    VisualIndicatorManager.getInstance().initialize(this);

    // Subscribe to configuration changes
    this.#configManager.addChangeListener(this.#handleConfigurationChange.bind(this));

    // Process any old conversations that missed memory extraction
    // Delay to avoid blocking startup and ensure tools are registered
    setTimeout(() => {
      this.processUnprocessedConversations();
    }, 5000);
  }

  /**
   * Gets the singleton instance of the agent service
   */
  static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService();
    }
    return AgentService.instance;
  }

  /**
   * Gets the API key currently configured for the agent
   */
  getApiKey(): string | null {
    return this.#apiKey;
  }

  /**
   * Initializes the LLM client with provider configurations
   */
  async #initializeLLMClient(): Promise<void> {
    const llm = LLMClient.getInstance();

    // Get configuration from manager (with override support)
    const config = this.#configManager.getConfiguration();
    const provider = config.provider;
    const apiKey = config.apiKey;
    const endpoint = config.endpoint;

    const providers = [];

    // Validate and add the selected provider
    // Skip credential checks in AUTOMATED_MODE where API keys come from request body
    const validation = this.#configManager.validateConfiguration(BUILD_CONFIG.AUTOMATED_MODE);
    if (!validation.isValid) {
      throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
    }

    // Build provider configuration using registry
    const providerConfig = this.#buildProviderConfig(provider, apiKey, endpoint);

    if (!providerConfig) {
      throw new Error(`No valid configuration found for provider ${provider}`);
    }

    providers.push(providerConfig);

    await llm.initialize({ providers });
    logger.info('LLM client initialized successfully', {
      selectedProvider: provider,
      providersRegistered: providers.map(p => p.provider),
      providersCount: providers.length
    });
  }

  /**
   * Build provider configuration for LLM initialization
   * Handles special cases like litellm endpoint and browseroperator optional key
   */
  #buildProviderConfig(
    provider: string,
    apiKey: string | undefined,
    endpoint: string | undefined
  ): {provider: string; apiKey: string; providerURL?: string} | null {
    // Check if it's a custom provider
    if (isCustomProvider(provider)) {
      const customConfig = CustomProviderManager.getProvider(provider);
      if (!customConfig) {
        logger.warn(`Custom provider ${provider} not found`);
        return null;
      }

      // Custom providers use their configured baseURL
      return {
        provider,
        apiKey: apiKey || '', // API key is optional for custom providers
        providerURL: customConfig.baseURL
      };
    }

    // Special case: litellm requires endpoint
    if (provider === 'litellm') {
      if (!endpoint) {
        logger.warn('LiteLLM provider requires endpoint');
        return null;
      }
      return {
        provider: 'litellm',
        apiKey: apiKey || '', // Can be empty for some LiteLLM endpoints
        providerURL: endpoint
      };
    }

    // Special case: browseroperator doesn't require apiKey
    if (provider === 'browseroperator') {
      return {
        provider: 'browseroperator',
        apiKey: apiKey || ''
      };
    }

    // Default: provider requires apiKey (unless in AUTOMATED_MODE where keys come dynamically)
    if (!apiKey && !BUILD_CONFIG.AUTOMATED_MODE) {
      logger.warn(`Provider ${provider} requires API key`);
      return null;
    }

    return {
      provider,
      apiKey: apiKey || ''  // Default to empty string for AUTOMATED_MODE
    };
  }

  /**
   * Initializes the agent with the given API key
   */
  async initialize(apiKey: string | null, modelName: string, miniModel: string, nanoModel: string): Promise<void> {
    try {
      this.#apiKey = apiKey;
      
      // Initialize LLM client first
      await this.#initializeLLMClient();
      
      // Check if the configuration requires an API key
      const requiresApiKey = this.#doesCurrentConfigRequireApiKey();
      
      // If API key is required but not provided, throw error (unless in AUTOMATED_MODE)
      if (requiresApiKey && !apiKey && !BUILD_CONFIG.AUTOMATED_MODE) {
        const provider = this.#configManager.getProvider();
        let providerName = 'OpenAI';
        if (provider === 'litellm') {
          providerName = 'LiteLLM';
        } else if (provider === 'groq') {
          providerName = 'Groq';
        } else if (provider === 'openrouter') {
          providerName = 'OpenRouter';
        } else if (provider === 'browseroperator') {
          providerName = 'BrowserOperator';
        }
        throw new Error(`${providerName} API key is required for this configuration`);
      }

      // Get provider from configuration manager
      const config = this.#configManager.getConfiguration();

      // Mini and nano models are injected by caller (validated upstream)

      // Will throw error if model/provider configuration is invalid
      this.#graph = createAgentGraph(apiKey, modelName, config.provider, miniModel, nanoModel);

      // Stash apiKey in state context for downstream tools that need it
      if (!this.#state.context) { (this.#state as any).context = {}; }
      (this.#state.context as any).apiKey = apiKey || '';

      this.#isInitialized = true;
    } catch (error) {
      logger.error('Failed to initialize agent:', error);
      // Pass through specific errors
      if (error instanceof Error && 
          (error.message.includes('API key is required') || 
           error.message.includes('endpoint is required'))) {
        throw error;
      }
      throw new Error(i18nString('agentInitFailed'));
    }
  }

  /**
   * Checks if the agent is initialized
   */
  isInitialized(): boolean {
    return this.#isInitialized;
  }

  /**
   * Resets the initialization state to allow re-initialization with new configuration.
   * This is useful when configuration overrides are set (e.g., API keys from request payload).
   */
  resetInitialization(): void {
    this.#isInitialized = false;
    this.#graph = undefined;
    this.#apiKey = null;
    logger.info('AgentService initialization state reset');
  }

  /**
   * Gets the current state of the agent
   */
  getState(): AgentState {
    return this.#state;
  }

  /**
   * Gets the messages from the agent
   */
  getMessages(): ChatMessage[] {
    return this.#state.messages;
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Generate a unique trace ID
   */
  private generateTraceId(): string {
    return `trace-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Initialize or reinitialize the tracing provider
   */
  async #initializeTracing(): Promise<void> {
    this.#tracingProvider = createTracingProvider();
    
    try {
      await this.#tracingProvider.initialize();
      await this.#tracingProvider.createSession(this.#sessionId, {
        source: 'devtools-ai-chat',
        startTime: new Date().toISOString()
      });
      logger.info('Tracing initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize tracing', error);
    }
  }

  /**
   * Refresh the tracing provider (called when configuration changes)
   */
  async refreshTracingProvider(): Promise<void> {
    logger.info('Refreshing tracing provider due to configuration change');
    await this.#initializeTracing();
  }

  /**
   * Handle configuration changes from LLMConfigurationManager
   */
  #handleConfigurationChange(): void {
    logger.info('LLM configuration changed, reinitializing if needed');

    // If we're initialized, we need to reinitialize with new configuration
    if (this.#isInitialized) {
      // Mark as uninitialized to force reinit on next use
      this.#isInitialized = false;
      this.#graph = undefined;

      logger.info('Marked agent service for reinitialization due to config change');
    }
  }

  /**
   * Public method to refresh credentials and agent service
   * Can be called from settings dialog or other components
   */
  async refreshCredentials(): Promise<void> {
    logger.info('Refreshing credentials and reinitializing agent service');

    this.#isInitialized = false;
    this.#graph = undefined;

    // Force reinitialization on next use
    try {
      const config = this.#configManager.getConfiguration();
      await this.initialize(config.apiKey || null, config.mainModel, config.miniModel || '', config.nanoModel || '');
      logger.info('Agent service reinitialized successfully');
    } catch (error) {
      logger.error('Failed to reinitialize agent service:', error);
      throw error;
    }
  }

  /**
   * Sends a message to the AI agent
   */
  async sendMessage(text: string, imageInput?: ImageInputData, selectedAgentType?: string | null): Promise<ChatMessage> {
    // Check if the current configuration requires an API key
    const requiresApiKey = this.#doesCurrentConfigRequireApiKey();

    if (requiresApiKey && !this.#apiKey && !BUILD_CONFIG.AUTOMATED_MODE) {
      throw new Error('API key not set. Please set the API key in settings.');
    }

    if (!text.trim()) {
      throw new Error('Empty message. Please enter some text.');
    }

    // Auto-initialize graph if it's not ready (handles race conditions automatically)
    if (!this.#graph) {
      logger.info('Graph not initialized, initializing now...');
      const config = this.#configManager.getConfiguration();
      // Initialize with API key from config (includes overrides set by EvaluationAgent)
      await this.initialize(config.apiKey || '', config.mainModel, config.miniModel || '', config.nanoModel || '');
    }

    // In normal mode, check if graph needs reinitialization (e.g., after config change)
    if (!BUILD_CONFIG.AUTOMATED_MODE && (!this.#isInitialized || !this.#graph)) {
      const config = this.#configManager.getConfiguration();
      await this.initialize(this.#apiKey, config.mainModel, config.miniModel || '', config.nanoModel || '');
    }

    // Create a user message
    const userMessage = createUserMessage(text, imageInput);

    // Add it to our message history
    this.#state.messages.push(userMessage);

    // Notify listeners of message update
    this.dispatchEventToListeners(Events.MESSAGES_CHANGED, [...this.#state.messages]);

    // Schedule auto-save
    void this.#scheduleAutoSave();

    // Get the user's current context (URL and title)
    const currentPageUrl = await this.#getCurrentPageUrl();
    const currentPageTitle = await this.#getCurrentPageTitle();

    const orchestratorKey = selectedAgentType ? `orchestrator:${selectedAgentType}` : 'orchestrator:default';
    const orchestratorDescriptor = await AgentDescriptorRegistry.getDescriptor(orchestratorKey) ||
      await AgentDescriptorRegistry.getDescriptor('orchestrator:default');
    if (orchestratorDescriptor) {
      this.#state.context.agentDescriptor = orchestratorDescriptor;
    }

    // Check if there's an existing tracing context (e.g., from evaluation)
    const existingContext = getCurrentTracingContext() as TracingContext | null;
    
    let traceId: string;
    let parentObservationId: string | undefined;
    
    if (existingContext?.traceId) {
      // Use the existing trace from evaluation context
      traceId = existingContext.traceId;
      parentObservationId = existingContext.parentObservationId;
      
      logger.debug('Using existing trace context from evaluation', {
        traceId,
        sessionId: existingContext.sessionId,
        parentObservationId,
        tracingEnabled: this.#tracingProvider.isEnabled()
      });
    } else {
      // Create a new trace for this interaction
      traceId = this.generateTraceId();
      
      logger.debug('Creating new trace for user message', {
        traceId,
        sessionId: this.#sessionId,
        tracingEnabled: this.#tracingProvider.isEnabled()
      });
      
      await this.#tracingProvider.createTrace(
        traceId,
        this.#sessionId,
        'User Message',
        { text, imageInput },
        {
          selectedAgentType,
          currentPageUrl,
          currentPageTitle,
          ...(orchestratorDescriptor ? {
            agentVersion: orchestratorDescriptor.version,
            agentName: orchestratorDescriptor.name,
            promptHash: orchestratorDescriptor.promptHash,
            toolsetHash: orchestratorDescriptor.toolsetHash
          } : {})
        },
        undefined, // userId
        [selectedAgentType || 'default'].filter(Boolean)
      );
    }

    console.warn('Trace context for user message', {
      traceId,
      sessionId: existingContext?.sessionId || this.#sessionId,
      selectedAgentType,
      currentPageUrl,
      currentPageTitle,
      messageCount: this.#state.messages.length,
      isExistingTrace: !!existingContext
    });

    // Create user input event
    await this.#tracingProvider.createObservation({
      id: `event-user-input-${Date.now()}`,
      name: 'User Input Received',
      type: 'event',
      startTime: new Date(),
      input: { 
        text, 
        hasImage: !!imageInput,
        messageLength: text.length,
        currentUrl: currentPageUrl
      },
      metadata: {
        selectedAgentType,
        currentPageUrl,
        currentPageTitle,
        messageCount: this.#state.messages.length,
        isEvaluationContext: !!existingContext,
        ...(orchestratorDescriptor ? {
          agentVersion: orchestratorDescriptor.version,
          agentName: orchestratorDescriptor.name,
          promptHash: orchestratorDescriptor.promptHash,
          toolsetHash: orchestratorDescriptor.toolsetHash
        } : {})
      },
      ...(parentObservationId && { parentObservationId })
    }, traceId);
    
    try {
      // Create initial state for this run
      const state: AgentState = {
        messages: this.#state.messages,
        context: {
          tracingContext: {
            sessionId: existingContext?.sessionId || this.#sessionId,
            traceId,
            parentObservationId: parentObservationId,
            // Forward metadata from evaluation context for Langfuse session grouping
            metadata: existingContext?.metadata
          },
          executionId: this.#executionId,
          abortSignal: this.#abortController?.signal,
          ...(orchestratorDescriptor ? { agentDescriptor: orchestratorDescriptor } : {})
        },
        selectedAgentType: selectedAgentType ?? null, // Set the agent type for this run
        currentPageUrl,
        currentPageTitle,
      };

      // Inject API key into context for tool execution paths (ConfigurableAgentTool)
      try { (state as any).context.apiKey = this.#apiKey || ''; } catch {}

      console.warn('Going to invoke graph', {
        traceId,
        sessionId: this.#sessionId,
        currentPageUrl,
        currentPageTitle,
        messageCount: this.#state.messages.length
      });

      // Create AbortController for this execution
      this.#executionId = `execution-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      this.#abortController = new AbortController();
      AgentService.registerExecution(this.#executionId, this.#abortController);
      // Ensure the abort signal is present in the state context for tools
      try {
        (state as any).context.abortSignal = this.#abortController.signal;
        (state as any).context.executionId = this.#executionId;
      } catch {}

      // Run the agent graph on the state
      console.warn('[AGENT SERVICE DEBUG] About to invoke graph with state:', {
        traceId,
        messagesCount: state.messages.length,
        hasTracingContext: !!state.context?.tracingContext
      });
      this.#runningGraphStatePromise = this.#graph?.invoke(state, this.#abortController.signal);

      // Wait for the result
      if (!this.#runningGraphStatePromise) {
        throw new Error('Agent graph not initialized. Please try again.');
      }

      // Iterate through the generator and update UI after each step
      for await (const currentState of this.#runningGraphStatePromise) {
        // Update our messages with the messages from the current step
        this.#state.messages = currentState.messages;

        // Notify listeners of message update immediately
        this.dispatchEventToListeners(Events.MESSAGES_CHANGED, [...this.#state.messages]);

        // Don't auto-save during iteration - wait for completion
      }

      // Schedule auto-save after loop completes with final state
      void this.#scheduleAutoSave();

      // Check if the last message is an error (it might have been added in the loop)
      const finalMessage = this.#state.messages[this.#state.messages.length - 1];
      if (!finalMessage) {
          throw new Error('No state returned from agent. Please try again.');
      }

      // Create success completion event
      await this.#tracingProvider.createObservation({
        id: `event-completion-${Date.now()}`,
        name: 'Agent Response Complete',
        type: 'event',
        startTime: new Date(),
        output: {
          messageType: finalMessage.entity,
          action: 'action' in finalMessage ? finalMessage.action : 'unknown',
          isFinalAnswer: 'isFinalAnswer' in finalMessage ? finalMessage.isFinalAnswer : false
        },
        metadata: {
          totalMessages: this.#state.messages.length,
          responseType: 'success',
          ...(orchestratorDescriptor ? {
            agentVersion: orchestratorDescriptor.version,
            agentName: orchestratorDescriptor.name,
            promptHash: orchestratorDescriptor.promptHash,
            toolsetHash: orchestratorDescriptor.toolsetHash
          } : {})
        }
      }, traceId);

      // Wait a moment for all async tracing operations to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Only finalize trace if we created a new one (not using existing evaluation trace)
      if (!existingContext) {
        await this.#tracingProvider.finalizeTrace(
          traceId,
          finalMessage,
          { status: 'success' }
        );
      }

      // Clean up execution state
      if (this.#executionId) {
        AgentService.unregisterExecution(this.#executionId);
        this.#executionId = undefined;
      }
      this.#abortController = undefined;
      // Clear running state - final message has already been sent to listeners at line 583
      this.#runningGraphStatePromise = undefined;

      // Return the most recent message (could be final answer, tool call, or error)
      return finalMessage;

    } catch (error) {
      logger.error('Error running agent:', error);

      // Create an error message from the model
      const errorMessage: ModelChatMessage = {
        entity: ChatMessageEntity.MODEL,
        action: 'final',
        answer: error instanceof Error ? error.message : String(error),
        isFinalAnswer: true,
        error: error instanceof Error ? error.message : String(error),
      };

      // Add it to our message history
      this.#state.messages.push(errorMessage);

      // Notify listeners of message update
      this.dispatchEventToListeners(Events.MESSAGES_CHANGED, [...this.#state.messages]);

      // Schedule auto-save
      void this.#scheduleAutoSave();

      // Create error completion event
      await this.#tracingProvider.createObservation({
        id: `event-error-${Date.now()}`,
        name: 'Agent Error',
        type: 'event',
        startTime: new Date(),
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          totalMessages: this.#state.messages.length,
          responseType: 'error',
          ...(orchestratorDescriptor ? {
            agentVersion: orchestratorDescriptor.version,
            agentName: orchestratorDescriptor.name,
            promptHash: orchestratorDescriptor.promptHash,
            toolsetHash: orchestratorDescriptor.toolsetHash
          } : {})
        }
      }, traceId);

      // Only finalize trace if we created a new one (not using existing evaluation trace)
      if (!existingContext) {
        await this.#tracingProvider.finalizeTrace(
          traceId,
          errorMessage,
          { status: 'error', error: error instanceof Error ? error.message : String(error) }
        );
      }

      // Clean up execution state
      if (this.#executionId) {
        AgentService.unregisterExecution(this.#executionId);
        this.#executionId = undefined;
      }
      this.#abortController = undefined;
      this.#runningGraphStatePromise = undefined;

      return errorMessage;
    }
  }

  /**
   * Gets the current conversation ID
   */
  getCurrentConversationId(): string | null {
    return this.#currentConversationId;
  }

  /**
   * Gets the current conversation title (auto-generated from first message)
   */
  getCurrentConversationTitle(): string {
    const firstUserMessage = this.#state.messages.find(msg => msg.entity === ChatMessageEntity.USER);
    if (firstUserMessage && 'text' in firstUserMessage) {
      const text = firstUserMessage.text as string;
      return text.length > 50 ? text.substring(0, 50) + '...' : text;
    }
    return 'New Chat';
  }

  /**
   * Auto-saves the current conversation (debounced)
   */
  async #scheduleAutoSave(): Promise<void> {
    // Clear existing timeout
    if (this.#autoSaveTimeoutId !== undefined) {
      clearTimeout(this.#autoSaveTimeoutId);
    }

    // Schedule new auto-save
    this.#autoSaveTimeoutId = setTimeout(async () => {
      try {
        const conversationId = await this.#conversationManager.autoSaveConversation(
          this.#currentConversationId,
          this.#state,
          this.getActiveAgentSessions()
        );

        // Update current conversation ID if it was created
        if (conversationId && conversationId !== this.#currentConversationId) {
          this.#currentConversationId = conversationId;
          this.dispatchEventToListeners(Events.CONVERSATION_CHANGED, conversationId);
        }

        if (conversationId) {
          this.dispatchEventToListeners(Events.CONVERSATION_SAVED, conversationId);
          logger.debug('Auto-saved conversation', { conversationId });
        }
      } catch (error) {
        logger.error('Failed to auto-save conversation', { error });
      }
    }, this.#autoSaveDebounceMs) as unknown as number;
  }

  /**
   * Clears any pending auto-save timeout to prevent memory leaks
   */
  #clearAutoSaveTimeout(): void {
    if (this.#autoSaveTimeoutId !== undefined) {
      clearTimeout(this.#autoSaveTimeoutId);
      this.#autoSaveTimeoutId = undefined;
    }
  }

  /**
   * Manually saves the current conversation
   */
  async saveConversation(): Promise<string | null> {
    try {
      const conversationId = await this.#conversationManager.autoSaveConversation(
        this.#currentConversationId,
        this.#state,
        this.getActiveAgentSessions()
      );

      if (conversationId && conversationId !== this.#currentConversationId) {
        this.#currentConversationId = conversationId;
        this.dispatchEventToListeners(Events.CONVERSATION_CHANGED, conversationId);
      }

      if (conversationId) {
        this.dispatchEventToListeners(Events.CONVERSATION_SAVED, conversationId);
        logger.info('Saved conversation', { conversationId });
      }

      return conversationId;
    } catch (error) {
      logger.error('Failed to save conversation', { error });
      return null;
    }
  }

  /**
   * Loads a conversation by ID
   */
  async loadConversation(conversationId: string): Promise<boolean> {
    try {
      const result = await this.#conversationManager.loadConversation(conversationId);

      if (!result) {
        logger.warn('Conversation not found', { conversationId });
        return false;
      }

      // Clear any pending auto-save timeout and abort execution
      this.#clearAutoSaveTimeout();
      this.cancelRun();

      // Load the state
      this.#state = result.state;
      this.#currentConversationId = conversationId;

      // Restore agent sessions
      this.#activeAgentSessions.clear();
      for (const session of result.agentSessions) {
        this.#activeAgentSessions.set(session.sessionId, session);
      }

      // Notify listeners
      this.dispatchEventToListeners(Events.MESSAGES_CHANGED, [...this.#state.messages]);
      this.dispatchEventToListeners(Events.CONVERSATION_CHANGED, conversationId);

      logger.info('Loaded conversation', {
        conversationId,
        messageCount: this.#state.messages.length,
        title: result.conversation.title
      });

      return true;
    } catch (error) {
      logger.error('Failed to load conversation', { error, conversationId });
      return false;
    }
  }

  /**
   * Starts a new conversation
   */
  async newConversation(): Promise<void> {
    // Capture conversation ID BEFORE clearing (for async memory extraction)
    const endingConversationId = this.#currentConversationId;

    // Clear any pending auto-save timeout and abort execution
    this.#clearAutoSaveTimeout();
    this.cancelRun();

    // Clear conversation ID
    this.#currentConversationId = null;

    // Create a fresh state
    this.#state = createInitialState();

    // Add welcome message
    this.#state.messages.push({
      entity: ChatMessageEntity.MODEL,
      action: 'final',
      answer: i18nString('welcomeMessage'),
      isFinalAnswer: true,
    });

    // Clear agent sessions
    this.#activeAgentSessions.clear();

    // Notify listeners
    this.dispatchEventToListeners(Events.MESSAGES_CHANGED, [...this.#state.messages]);
    this.dispatchEventToListeners(Events.CONVERSATION_CHANGED, null);

    logger.info('Started new conversation');

    // Fire off memory extraction in background (non-blocking)
    if (endingConversationId) {
      this.#processConversationMemory(endingConversationId);
    }
  }

  /**
   * Processes memory for a conversation. Uses claim mechanism to prevent
   * concurrent processing of the same conversation.
   */
  async #processConversationMemory(conversationId: string): Promise<void> {
    logger.info('[Memory] Starting processing for conversation', {conversationId});
    // Check if memory is enabled in settings
    if (!MemoryModule.getInstance().isEnabled()) {
      logger.info('[Memory] Skipping - memory disabled in settings');
      return;
    }

    // Try to claim - if another instance is processing, skip
    const claimed = await this.#conversationManager.tryClaimForMemoryProcessing(conversationId);
    if (!claimed) {
      logger.info('[Memory] Skipping - already processing or completed', {conversationId});
      return;
    }

    try {
      // Load the conversation to get messages
      const loaded = await this.#conversationManager.loadConversation(conversationId);
      if (!loaded || loaded.state.messages.length < 4) {
        // Mark as completed (nothing to extract)
        await this.#conversationManager.markMemoryCompleted(conversationId);
        logger.info('[Memory] Skipping - conversation too short', {conversationId, messageCount: loaded?.state.messages.length || 0});
        return;
      }

      // Format conversation summary
      const conversationSummary = loaded.state.messages
        .filter(m => m.entity === ChatMessageEntity.USER || m.entity === ChatMessageEntity.MODEL)
        .slice(-20)
        .map(m => {
          const role = m.entity === ChatMessageEntity.USER ? 'User' : 'Assistant';
          const text = m.entity === ChatMessageEntity.USER
            ? (m as {text: string}).text
            : ((m as ModelChatMessage).answer || '');
          return `${role}: ${text}`;
        })
        .join('\n');

      const memoryAgent = ToolRegistry.getToolInstance('memory_agent');
      if (!memoryAgent) {
        await this.#conversationManager.markMemoryFailed(conversationId);
        logger.warn('[Memory] memory_agent not found in registry');
        return;
      }

      const config = this.#configManager.getConfiguration();
      logger.info('[Memory] Processing conversation', {
        conversationId,
        provider: config.provider,
        model: config.mainModel,
        miniModel: config.miniModel,
        summaryLength: conversationSummary.length
      });

      const result = await memoryAgent.execute({
        conversation_summary: conversationSummary,
        reasoning: 'Extracting facts from conversation',
      }, {
        apiKey: config.apiKey,
        provider: config.provider,
        model: config.mainModel,
        miniModel: config.miniModel,
        nanoModel: config.nanoModel,
        background: true,  // Don't show in UI
      });

      logger.info('[Memory] Agent execution result', {
        conversationId,
        success: result.success,
        outputLength: result.output?.length || 0,
        outputPreview: result.output?.substring(0, 500),
        error: result.error,
        terminationReason: result.terminationReason,
        toolCallsCount: result.toolCalls?.length || 0,
        toolCalls: result.toolCalls?.map((tc: any) => ({ name: tc.name, args: tc.args })) || [],
      });

      await this.#conversationManager.markMemoryCompleted(conversationId);
      logger.info('[Memory] Completed', {conversationId});

    } catch (err) {
      logger.error('[Memory] Failed:', err);
      await this.#conversationManager.markMemoryFailed(conversationId);
    }
  }

  /**
   * Processes any old conversations that never had memory extracted.
   * Call this on initialization or periodically.
   */
  async processUnprocessedConversations(): Promise<void> {
    const pending = await this.#conversationManager.getConversationsNeedingMemoryProcessing();

    // Skip the currently active conversation and limit to avoid overload
    const toProcess = pending
      .filter(conv => conv.id !== this.#currentConversationId)
      .slice(0, 3);

    for (const conv of toProcess) {
      // Don't await - process in parallel
      this.#processConversationMemory(conv.id);
    }

    if (pending.length > 0) {
      logger.info('[Memory] Processing unprocessed conversations', {
        total: pending.length,
        processing: toProcess.length,
      });
    }
  }

  /**
   * Lists all saved conversations
   */
  async listConversations(): Promise<ConversationMetadata[]> {
    try {
      return await this.#conversationManager.listConversations();
    } catch (error) {
      logger.error('Failed to list conversations', { error });
      return [];
    }
  }

  /**
   * Deletes a conversation by ID
   */
  async deleteConversation(conversationId: string): Promise<boolean> {
    try {
      await this.#conversationManager.deleteConversation(conversationId);

      // If we deleted the current conversation, start a new one
      if (conversationId === this.#currentConversationId) {
        await this.newConversation();
      }

      logger.info('Deleted conversation', { conversationId });
      return true;
    } catch (error) {
      logger.error('Failed to delete conversation', { error, conversationId });
      return false;
    }
  }

  /**
   * Updates the title of a conversation
   */
  async updateConversationTitle(conversationId: string, newTitle: string): Promise<boolean> {
    try {
      await this.#conversationManager.updateConversationTitle(conversationId, newTitle);
      logger.info('Updated conversation title', { conversationId, newTitle });
      return true;
    } catch (error) {
      logger.error('Failed to update conversation title', { error, conversationId });
      return false;
    }
  }

  /**
   * Clears the conversation history (creates a new conversation)
   */
  clearConversation(): void {
    // Use newConversation() for consistency
    void this.newConversation();
  }

  /**
   * Cancels any in-flight agent execution without clearing conversation state.
   */
  cancelRun(): void {
    logger.info('Cancelling current agent execution (without clearing messages)');
    // Clear any pending auto-save timeout
    this.#clearAutoSaveTimeout();
    if (this.#executionId) {
      const controller = AgentService.getExecutionController(this.#executionId);
      try { controller?.abort(); } catch {}
      AgentService.unregisterExecution(this.#executionId);
      this.#executionId = undefined;
    }
    try { this.#abortController?.abort(); } catch {}
    this.#abortController = undefined;
    this.#runningGraphStatePromise = undefined;
  }

  /**
   * Sets the API key for the agent and re-initializes the graph
   * @param apiKey The new API key
   */
  setApiKey(apiKey: string): void {
    this.#apiKey = apiKey;
    this.#isInitialized = false; // Force re-initialization on next message
  }

  /**
   * Gets the current page URL from the target
   */
  async #getCurrentPageUrl(): Promise<string> {
    // Ensure browser deps are loaded
    if (!(await ensureBrowserDeps()) || !SDK) {
      return '';
    }
    let pageUrl = '';
    const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
    if (target) {
      try {
        const urlResult = await target.runtimeAgent().invoke_evaluate({
          expression: 'window.location.href',
          returnByValue: true
        });

        if (urlResult.result && !urlResult.exceptionDetails) {
          pageUrl = urlResult.result.value || '';
        }
      } catch (error) {
        logger.error('Error fetching page URL:', error);
      }
    }
    return pageUrl;
  }

  /**
   * Gets the current page title from the target
   */
  async #getCurrentPageTitle(): Promise<string> {
    // Ensure browser deps are loaded
    if (!(await ensureBrowserDeps()) || !SDK) {
      return '';
    }
    let pageTitle = '';
    const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
    if (target) {
      try {
        const titleResult = await target.runtimeAgent().invoke_evaluate({
          expression: 'document.title',
          returnByValue: true
        });

        if (titleResult.result && !titleResult.exceptionDetails) {
          pageTitle = titleResult.result.value || '';
        }
      } catch (error) {
        logger.error('Error fetching page title:', error);
      }
    }
    return pageTitle;
  }
  
  /**
   * Helper to determine if the current configuration requires an API key
   * LiteLLM with an endpoint doesn't require an API key, other providers do
   */
  #doesCurrentConfigRequireApiKey(): boolean {
    try {
      const selectedProvider = this.#configManager.getProvider();

      // Special case: browseroperator doesn't require API key
      if (selectedProvider === 'browseroperator') {
        return false;
      }

      // Special case: custom providers have optional API keys
      if (isCustomProvider(selectedProvider)) {
        return false;
      }

      // Special case: litellm only requires API key if no endpoint is configured
      if (selectedProvider === 'litellm') {
        const endpoint = LLMProviderRegistry.getProviderEndpoint(selectedProvider);
        // If we have an endpoint, API key is optional
        return !endpoint;
      }

      // All other providers require API key
      return true;
    } catch (error) {
      logger.error('Error checking if API key is required:', error);
      // Default to requiring API key in case of errors
      return true;
    }
  }
  
  /**
   * Handle progress events from AgentRunner
   */
  #handleAgentProgress(event: { data: import('../agent_framework/AgentRunnerEventBus.js').AgentRunnerProgressEvent }): void {
    const progressEvent = event.data;
    
    switch (progressEvent.type) {
      case 'session_started':
        this.#activeAgentSessions.set(progressEvent.sessionId, progressEvent.data.session);
        this.dispatchEventToListeners(Events.AGENT_SESSION_STARTED, progressEvent.data.session);
        // Upsert AGENT_SESSION message for real-time rendering
        this.#upsertAgentSessionInMessages(progressEvent.data.session);
        break;
      case 'tool_started':
        this.dispatchEventToListeners(Events.AGENT_TOOL_STARTED, progressEvent.data);
        // Stream session update into chat messages (parent or child)
        this.#upsertAgentSessionInMessages(progressEvent.data.session);
        break;
      case 'tool_completed':
        this.dispatchEventToListeners(Events.AGENT_TOOL_COMPLETED, progressEvent.data);
        // Update session state
        const session = this.#activeAgentSessions.get(progressEvent.sessionId);
        if (session) {
          this.dispatchEventToListeners(Events.AGENT_SESSION_UPDATED, session);
          // Stream session update into chat messages
          this.#upsertAgentSessionInMessages(session);
        }
        break;
      case 'child_agent_started':
        this.dispatchEventToListeners(Events.CHILD_AGENT_STARTED, progressEvent.data);
        // Also reflect child placeholder in the parent's message if present
        {
          const parent = progressEvent.data.parentSession as AgentSession | undefined;
          if (parent) {
            this.#upsertAgentSessionInMessages(parent);
          }
        }
        break;
      case 'session_completed':
        // Get the completed session from the event data or active sessions
        const completedSession = progressEvent.data?.session ||
                                this.#activeAgentSessions.get(progressEvent.sessionId);

        if (completedSession) {
          logger.info('[AgentService] Session completed:', {
            sessionId: progressEvent.sessionId,
            status: completedSession.status,
            terminationReason: completedSession.terminationReason
          });

          // Update the session in our tracking with the completed state
          this.#activeAgentSessions.set(progressEvent.sessionId, completedSession);

          // Upsert the completed session to messages (shows final_answer in transcript)
          this.#upsertAgentSessionInMessages(completedSession);

          // Dispatch completion event for UI components
          this.dispatchEventToListeners(Events.AGENT_SESSION_COMPLETED, completedSession);

          // Also dispatch session updated for components listening to that
          this.dispatchEventToListeners(Events.AGENT_SESSION_UPDATED, completedSession);

          // Trigger messages changed to update the chat transcript
          this.dispatchEventToListeners(Events.MESSAGES_CHANGED, [...this.#state.messages]);

          // Schedule auto-save after session completion
          void this.#scheduleAutoSave();

          // Clean up after a short delay (5 seconds) to allow UI to finish rendering
          this.#cleanupCompletedSession(progressEvent.sessionId);
        } else {
          logger.warn('[AgentService] Session completed but session not found:', progressEvent.sessionId);
        }
        break;
    }
  }

  // Upsert helper: ensures the chat transcript reflects the latest AgentSession state in real-time
  #upsertAgentSessionInMessages(session: AgentSession): void {
    // If this is a child session, update the parent container too
    if (session.parentSessionId) {
      // Find parent message and update nestedSessions
      const parentIdx = this.#state.messages.findIndex(m =>
        (m as any).entity === ChatMessageEntity.AGENT_SESSION &&
        ((m as any).agentSession?.sessionId === session.parentSessionId)
      );
      if (parentIdx !== -1) {
        const parentMsg = this.#state.messages[parentIdx] as any;
        const parentSession = parentMsg.agentSession as AgentSession;
        const nested = Array.isArray(parentSession.nestedSessions) ? [...parentSession.nestedSessions] : [];
        const nIdx = nested.findIndex(s => s.sessionId === session.sessionId);
        if (nIdx !== -1) {
          nested[nIdx] = session;
        } else {
          nested.push(session);
        }
        const updatedParent = { ...parentSession, nestedSessions: nested } as AgentSession;
        this.#state.messages[parentIdx] = { ...parentMsg, agentSession: updatedParent };
        this.dispatchEventToListeners(Events.MESSAGES_CHANGED, [...this.#state.messages]);
        void this.#scheduleAutoSave();
        return;
      }
    }

    // Otherwise, upsert the session as a top-level AGENT_SESSION message
    const idx = this.#state.messages.findIndex(m =>
      (m as any).entity === ChatMessageEntity.AGENT_SESSION &&
      ((m as any).agentSession?.sessionId === session.sessionId)
    );
    if (idx !== -1) {
      const existing = this.#state.messages[idx] as any;
      this.#state.messages[idx] = { ...existing, agentSession: session };
    } else {
      // Only add as top-level if it has no parent
      if (!session.parentSessionId) {
        this.#state.messages.push({ entity: ChatMessageEntity.AGENT_SESSION, agentSession: session } as any);
      }
    }
    this.dispatchEventToListeners(Events.MESSAGES_CHANGED, [...this.#state.messages]);
    void this.#scheduleAutoSave();
  }
  
  /**
   * Get active agent sessions
   */
  getActiveAgentSessions(): AgentSession[] {
    return Array.from(this.#activeAgentSessions.values());
  }
  
  /**
   * Clean up completed session
   */
  #cleanupCompletedSession(sessionId: string): void {
    const session = this.#activeAgentSessions.get(sessionId);
    if (session && (session.status === 'completed' || session.status === 'error')) {
      // Keep for a short time for UI to finish rendering
      setTimeout(() => {
        this.#activeAgentSessions.delete(sessionId);
      }, 5000);
    }
  }

}

// Define UI strings object to manage i18n strings
const UIStrings = {
  /**
   * @description Welcome message for empty conversation
   */
  welcomeMessage: 'Hello! I\'m your AI assistant. How can I help you today?',
  /**
   * @description Error message when the agent fails to initialize
   */
  agentInitFailed: 'Failed to initialize agent.',
} as const;

// i18n function - returns raw string in Node environment, localized string in browser
function i18nString(key: keyof typeof UIStrings): string {
  if (isNodeEnvironment || !i18n) {
    return UIStrings[key];
  }
  // Lazily initialize i18n registration on first call
  if (!i18nInitialized) {
    i18nInitialized = true;
    str_ = i18n.i18n.registerUIStrings('panels/ai_chat/core/AgentService.ts', UIStrings);
  }
  if (!str_) {
    return UIStrings[key];
  }
  return i18n.i18n.getLocalizedString(str_, UIStrings[key]);
}
let i18nInitialized = false;
let str_: ReturnType<typeof import('../../../core/i18n/i18n.js').i18n.registerUIStrings> | null = null;

// Register as a module (browser-only)
if (!isNodeEnvironment) {
  // Defer registration to ensure browser deps are loaded
  void ensureBrowserDeps().then(() => {
    if (Common && UI) {
      Common.Revealer.registerRevealer({
        contextTypes() {
          return [AgentService];
        },
        async loadRevealer() {
          return {
            reveal: async(agentService: AgentService): Promise<void> => {
              if (!(agentService instanceof AgentService)) {
                return;
              }
              // Reveal the AI Chat panel
              await UI?.ViewManager.ViewManager.instance().showView('ai-chat');
            }
          };
        }
      });
    }
  });
}
