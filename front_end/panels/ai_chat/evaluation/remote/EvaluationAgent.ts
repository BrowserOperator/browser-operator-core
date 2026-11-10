// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
// Cache break: 2025-09-17T17:38:00Z - Fixed API key validation

import { BUILD_CONFIG } from '../../core/BuildConfig.js';
import { WebSocketRPCClient } from '../../common/WebSocketRPCClient.js';
import { LLMConfigurationManager, type LLMConfig } from '../../core/LLMConfigurationManager.js';
import { getEvaluationConfig, getEvaluationClientId } from '../../common/EvaluationConfig.js';
import { ToolRegistry, ConfigurableAgentTool } from '../../agent_framework/ConfigurableAgentTool.js';
import { AgentService } from '../../core/AgentService.js';
import { AIChatPanel } from '../../ui/AIChatPanel.js';
import { createLogger } from '../../core/Logger.js';
import { createTracingProvider, withTracingContext, isTracingEnabled, getTracingConfig, setTracingConfig, refreshTracingProvider } from '../../tracing/TracingConfig.js';
import { AgentDescriptorRegistry, type AgentDescriptor } from '../../core/AgentDescriptorRegistry.js';
import '../../core/BaseOrchestratorAgent.js';
import type { TracingProvider, TracingContext } from '../../tracing/TracingProvider.js';
import type { ChatMessage } from '../../models/ChatTypes.js';
import { ChatMessageEntity } from '../../models/ChatTypes.js';
import {
  RegisterMessage,
  ReadyMessage,
  StatusMessage,
  WelcomeMessage,
  RegistrationAckMessage,
  AuthVerifyMessage,
  EvaluationRequest,
  EvaluationSuccessResponse,
  EvaluationErrorResponse,
  LLMConfigurationRequest,
  LLMConfigurationResponse,
  ToolExecutionRequest,
  ErrorCodes,
  isWelcomeMessage,
  isRegistrationAckMessage,
  isEvaluationRequest,
  isLLMConfigurationRequest,
  isToolExecutionRequest,
  isPongMessage,
  createRegisterMessage,
  createReadyMessage,
  createAuthVerifyMessage,
  createStatusMessage,
  createSuccessResponse,
  createErrorResponse,
  createLLMConfigurationResponse,
  createToolExecutionSuccessResponse,
  createToolExecutionErrorResponse
} from './EvaluationProtocol.js';

const logger = createLogger('EvaluationAgent');

export interface EvaluationAgentOptions {
  clientId: string;
  endpoint: string;
  secretKey?: string;
  // Explicit models to avoid UI coupling
  judgeModel: string;
  miniModel: string;
  nanoModel: string;
}


export class EvaluationAgent {
  private client: WebSocketRPCClient | null = null;
  private clientId: string;
  private endpoint: string;
  private secretKey?: string;
  private registered = false;
  private ready = false;
  private activeEvaluations = new Map<string, any>();
  private heartbeatInterval: number | null = null;
  private authPromise: Promise<void> | null = null;
  private authResolve: ((value?: void) => void) | null = null;
  private authReject: ((reason?: any) => void) | null = null;
  private tracingProvider: TracingProvider;
  private judgeModel: string;
  private miniModel: string;
  private nanoModel: string;
  private orchestratorDescriptorPromise: Promise<AgentDescriptor | null>;

  constructor(options: EvaluationAgentOptions) {
    this.clientId = options.clientId;
    this.endpoint = options.endpoint;
    this.secretKey = options.secretKey;
    this.judgeModel = options.judgeModel;
    this.miniModel = options.miniModel;
    this.nanoModel = options.nanoModel;
    this.tracingProvider = createTracingProvider();
    this.orchestratorDescriptorPromise = AgentDescriptorRegistry.getDescriptor('orchestrator:default');
    
    logger.info('EvaluationAgent created with tracing provider', {
      clientId: this.clientId,
      providerType: this.tracingProvider.constructor.name,
      tracingEnabled: isTracingEnabled(),
      tracingConfig: getTracingConfig()
    });
  }

  public async connect(): Promise<void> {
    if (this.client && this.client.isConnectionReady() && this.registered) {
      logger.warn('Already connected and authenticated');
      return;
    }

    logger.info('Connecting to evaluation server', {
      endpoint: this.endpoint,
      clientId: this.clientId
    });

    // Create authentication promise
    this.authPromise = new Promise((resolve, reject) => {
      this.authResolve = resolve;
      this.authReject = reject;
    });

    this.client = new WebSocketRPCClient({
      endpoint: this.endpoint,
      secretKey: this.secretKey,
      reconnectAttempts: 5,
      reconnectDelay: 2000
    });

    // Setup event handlers
    this.setupEventHandlers();

    // Connect to server
    await this.client.connect();
    
    // Wait for authentication to complete
    await this.authPromise;
  }

  public disconnect(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }

    this.registered = false;
    this.ready = false;
    this.activeEvaluations.clear();

    logger.info('Disconnected from evaluation server');
  }

  public isConnected(): boolean {
    return (this.client?.isConnectionReady() && this.registered) || false;
  }

  public isRegistered(): boolean {
    return this.registered;
  }

  public isReady(): boolean {
    return this.ready;
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on('connected', () => {
      logger.info('WebSocket connected, waiting for welcome message');
    });

    this.client.on('disconnected', () => {
      logger.info('WebSocket disconnected');
      this.registered = false;
      this.ready = false;
      this.stopHeartbeat();
    });

    this.client.on('message', (data: any) => {
      this.handleMessage(data);
    });

    this.client.on('error', (error: any) => {
      logger.error('WebSocket error:', typeof error === 'object' ? JSON.stringify(error) : error);
    });
  }

  private async handleMessage(message: any): Promise<void> {
    try {
      if (isWelcomeMessage(message)) {
        logger.info('Received welcome message from server', {
          serverId: message.serverId,
          version: message.version
        });
        await this.register();
      }
      else if (isRegistrationAckMessage(message)) {
        this.handleRegistrationAck(message);
      }
      else if (isEvaluationRequest(message)) {
        await this.handleEvaluationRequest(message);
      }
      else if (isLLMConfigurationRequest(message)) {
        await this.handleLLMConfigurationRequest(message);
      }
      else if (isToolExecutionRequest(message)) {
        await this.handleToolExecutionRequest(message);
      }
      else if (isPongMessage(message)) {
        logger.debug('Received pong');
      }
      else {
        logger.warn('Unknown message type:', message);
      }
    } catch (error) {
      logger.error('Error handling message:', error instanceof Error ? error.message : String(error));
    }
  }

  private async register(): Promise<void> {
    if (!this.client) return;

    const tools: string[] = [];
    
    const registerMessage = createRegisterMessage(
      this.clientId,
      {
        tools,
        maxConcurrency: 3,
        version: '1.0.0'
      }
      // Note: No secret key sent - server will send its key for client verification
    );

    logger.info('Registering with server', {
      clientId: this.clientId,
      tools: tools.join(', ')
    });

    this.client.send(registerMessage);
  }

  private handleRegistrationAck(message: RegistrationAckMessage): void {
    if (message.status === 'accepted') {
      logger.info('Registration accepted', {
        evaluationsCount: message.evaluationsCount
      });
      this.registered = true;
      this.sendReady();
      this.startHeartbeat();
      
      // Resolve auth promise - connection is complete
      if (this.authResolve) {
        this.authResolve();
        this.authResolve = null;
        this.authReject = null;
      }
    } else if (message.status === 'auth_required') {
      logger.info('Server requesting authentication verification');
      this.handleAuthRequest(message);
    } else {
      if (message.newClient) {
        logger.info('New client created, will retry connection', {
          reason: message.reason
        });
        // For new clients, the server created the config and asks to reconnect
        // We can attempt to reconnect after a short delay
        setTimeout(() => {
          if (this.client) {
            this.register();
          }
        }, 1000);
      } else {
        logger.error('Registration rejected', {
          reason: message.reason
        });
        
        // Reject auth promise - authentication failed
        if (this.authReject) {
          this.authReject(new Error(`Registration rejected: ${message.reason}`));
          this.authResolve = null;
          this.authReject = null;
        }
        
        this.disconnect();
      }
    }
  }

  private async handleAuthRequest(message: RegistrationAckMessage): Promise<void> {
    // In automated mode, skip authentication entirely
    if (BUILD_CONFIG.AUTOMATED_MODE) {
      logger.info('Automated mode: Skipping authentication verification');
      const authMessage = createAuthVerifyMessage(message.clientId, true);
      this.client?.send(authMessage);
      return;
    }

    if (!message.serverSecretKey) {
      logger.error('Server did not provide secret key for verification');
      this.disconnect();
      return;
    }

    // Get the client's configured secret key from EvaluationConfig
    const config = getEvaluationConfig();
    const clientSecretKey = config.secretKey || '';

    // Verify if the server's secret key matches the client's configured key
    const verified = clientSecretKey === message.serverSecretKey;

    logger.info('Verifying secret key', { 
      hasClientKey: !!clientSecretKey,
      hasServerKey: !!message.serverSecretKey,
      verified 
    });

    // Send verification response
    const authMessage = createAuthVerifyMessage(message.clientId, verified);
    this.client?.send(authMessage);

    if (!verified) {
      logger.error('Secret key verification failed - keys do not match');
      // Reject auth promise immediately since we know auth will fail
      if (this.authReject) {
        this.authReject(new Error('Secret key verification failed - keys do not match'));
        this.authResolve = null;
        this.authReject = null;
      }
    }
  }

  private sendReady(): void {
    if (!this.client || !this.registered) return;

    const readyMessage = createReadyMessage();
    this.client.send(readyMessage);
    this.ready = true;

    logger.info('Sent ready signal to server');
  }

  private async handleEvaluationRequest(request: EvaluationRequest): Promise<void> {
    const { params, id } = request;
    const startTime = Date.now();
    let hasSetEarlyOverride = false;

    logger.info('Received evaluation request', {
      evaluationId: params.evaluationId,
      tool: params.tool,
      url: params.url,
      isChat: params.tool === 'chat',
      modelOverride: (typeof params.input === 'object' && !Array.isArray(params.input)) ? (params.input as any).ai_chat_model : undefined,
      modelConfig: params.model
    });

    // CRITICAL FIX: Set configuration override early for any model configuration provided
    // This allows API keys from request body to be available for UI-level validation
    logger.info('DEBUG: Checking for model configuration override', {
      evaluationId: params.evaluationId,
      hasModel: !!params.model,
      model: params.model
    });

    if (params.model && (params.model.main_model || params.model.provider || params.model.api_key)) {
      const configManager = LLMConfigurationManager.getInstance();

      // Extract configuration from nested model structure - handle both flat and nested formats
      const mainModel = params.model.main_model as any;

      // For nested format: main_model: { provider: "openai", model: "gpt-4", api_key: "key" }
      // For flat format: { provider: "openai", main_model: "gpt-4", api_key: "key" }
      const provider = mainModel?.provider || params.model.provider || 'openai';
      const apiKey = mainModel?.api_key || params.model.api_key;
      const modelName = mainModel?.model || mainModel || params.model.main_model;
      const miniModel = (params.model.mini_model as any)?.model || params.model.mini_model;
      const nanoModel = (params.model.nano_model as any)?.model || params.model.nano_model;

      logger.info('DEBUG: Extracted model configuration', {
        evaluationId: params.evaluationId,
        mainModel,
        provider,
        hasApiKey: !!apiKey,
        apiKeyLength: apiKey?.length,
        modelName,
        miniModel,
        nanoModel
      });

      if (apiKey) {
        logger.info('Setting early configuration override for evaluation', {
          evaluationId: params.evaluationId,
          provider,
          hasApiKey: !!apiKey,
          modelName
        });

        configManager.setOverride({
          provider,
          apiKey,
          mainModel: modelName,
          miniModel: miniModel || modelName,
          nanoModel: nanoModel || miniModel || modelName
        });
        hasSetEarlyOverride = true;

        // Reset AgentService to force re-initialization with new configuration
        const agentService = AgentService.getInstance();
        agentService.resetInitialization();

        logger.info('DEBUG: Early override set and AgentService reset successfully', {
          evaluationId: params.evaluationId
        });
      } else {
        logger.warn('DEBUG: No API key found in model configuration', {
          evaluationId: params.evaluationId,
          mainModel,
          provider
        });
      }
    } else {
      logger.warn('DEBUG: No model configuration found for override', {
        evaluationId: params.evaluationId,
        hasModel: !!params.model,
        hasMainModel: !!(params.model?.main_model),
        hasProvider: !!(params.model?.provider),
        hasApiKey: !!(params.model?.api_key)
      });
    }

    // Track active evaluation
    this.activeEvaluations.set(params.evaluationId, {
      startTime,
      tool: params.tool
    });

    // Use tracing metadata from request params (from eval framework via api-server)
    // The tracing field is now properly forwarded through BrowserAgentServer.executeRequest()
    const requestTracing = params.tracing || {};
    logger.info('Tracing metadata received:', {
      hasTracing: !!params.tracing,
      tracingKeys: Object.keys(requestTracing),
      sessionId: requestTracing.session_id,
      traceId: requestTracing.trace_id,
      hasLangfuseCredentials: !!(requestTracing.langfuse_endpoint && requestTracing.langfuse_public_key && requestTracing.langfuse_secret_key)
    });

    // Auto-configure Langfuse tracing from request if credentials provided and not already enabled
    if (requestTracing.langfuse_endpoint &&
        requestTracing.langfuse_public_key &&
        requestTracing.langfuse_secret_key &&
        !isTracingEnabled()) {
      logger.info('Auto-configuring DevTools Langfuse tracing from request', {
        endpoint: requestTracing.langfuse_endpoint,
        hasPublicKey: true,
        hasSecretKey: true
      });

      setTracingConfig({
        provider: 'langfuse',
        endpoint: requestTracing.langfuse_endpoint,
        publicKey: requestTracing.langfuse_public_key,
        secretKey: requestTracing.langfuse_secret_key
      });

      // Refresh the tracing provider to pick up new configuration
      await refreshTracingProvider();

      // Update this instance's tracing provider
      this.tracingProvider = createTracingProvider();

      logger.info('DevTools Langfuse tracing configured successfully from request');
    }


    // Create a trace for this evaluation - use tracing from request if available
    const traceId = requestTracing.trace_id || `eval-${params.evaluationId}-${Date.now()}`;
    const sessionId = requestTracing.session_id || `eval-session-${Date.now()}`;
    const tracingContext: TracingContext = {
      traceId,
      sessionId,
      parentObservationId: undefined,
      // Include full tracing metadata for LLM calls (session grouping in Langfuse)
      metadata: requestTracing
    };
    const orchestratorDescriptor = await this.orchestratorDescriptorPromise;
    
    try {
      // Initialize tracing provider if not already done
      await this.tracingProvider.initialize();
      
      // Create session for this evaluation
      await this.tracingProvider.createSession(sessionId, {
        type: 'evaluation',
        source: 'evaluation-server',
        evaluationId: params.evaluationId
      });
      
      // Create root trace for the evaluation
      await this.tracingProvider.createTrace(
        traceId,
        sessionId,
        `Evaluation: ${params.tool}`,
        params.input,
        {
          evaluationId: params.evaluationId,
          tool: params.tool,
          url: params.url,
          source: 'evaluation-server',
          ...(orchestratorDescriptor ? {
            agentVersion: orchestratorDescriptor.version,
            agentName: orchestratorDescriptor.name,
            promptHash: orchestratorDescriptor.promptHash,
            toolsetHash: orchestratorDescriptor.toolsetHash
          } : {})
        },
        'evaluation-agent',
        ['evaluation', params.tool]
      );
      
      logger.info('Trace created successfully for evaluation', {
        traceId,
        sessionId,
        evaluationId: params.evaluationId
      });
    } catch (error) {
      logger.warn('Failed to create trace:', error);
    }

    try {
      // Send status update
      this.sendStatus(params.evaluationId, 'running', 0.1, 'Starting evaluation...');

      // Get the tool from registry (only for non-chat evaluations)
      let tool: any = null;
      if (params.tool !== 'chat') {
        tool = ToolRegistry.getRegisteredTool(params.tool);
        if (!tool) {
          throw new Error(`Tool not found: ${params.tool}`);
        }
      }

      // Navigate to URL if needed
      if (params.url) {
        this.sendStatus(params.evaluationId, 'running', 0.2, 'Navigating to URL...');
        
        try {
          // Use the correct navigate_url tool from registry
          const navigateUrlTool = ToolRegistry.getRegisteredTool('navigate_url');
          if (navigateUrlTool) {
            logger.info('Navigating to URL using navigate_url tool', { url: params.url });
            const navigationResult = await this.executeToolWithTimeout(
              navigateUrlTool,
              { 
                url: params.url,
                reasoning: `Navigate to ${params.url} for evaluation ${params.evaluationId}`
              },
              15000, // 15 second timeout for navigation
              tracingContext,
              'navigate_url'
            );
            logger.info('Navigation result', { navigationResult });
            this.sendStatus(params.evaluationId, 'running', 0.3, 'Navigation completed successfully');
          } else {
            // Fallback: try action_agent for navigation
            const actionTool = ToolRegistry.getRegisteredTool('action_agent');
            if (actionTool) {
              logger.info('Navigating to URL using action_agent fallback', { url: params.url });
              const navigationResult = await this.executeToolWithTimeout(
                actionTool,
                { 
                  task: `Navigate to ${params.url}`,
                  reasoning: 'Navigation required for evaluation'
                },
                15000, // 15 second timeout for navigation
                tracingContext,
                'action_agent'
              );
              logger.info('Action agent navigation result', { navigationResult });
              this.sendStatus(params.evaluationId, 'running', 0.3, 'Navigation completed via action agent');
            } else {
              logger.error('No navigation tools available in registry');
              this.sendStatus(params.evaluationId, 'running', 0.3, 'ERROR: No navigation tools available');
              throw new Error('Navigation failed: No navigation tools available');
            }
          }
        } catch (error) {
          logger.error('Navigation failed', { url: params.url, error: error instanceof Error ? error.message : error });
          this.sendStatus(params.evaluationId, 'running', 0.3, `Navigation failed: ${error instanceof Error ? error.message : 'Unknown error'} - continuing with current page`);
          // Continue with evaluation even if navigation fails, but log the issue prominently
        }
      }

      // Check if this is a chat evaluation that needs AgentService
      let toolResult: any;
      
      if (params.tool === 'chat') {
        // Handle chat evaluations using AgentService
        this.sendStatus(params.evaluationId, 'running', 0.5, 'Processing chat request...');
        
        // Merge model configuration - prefer params.model over params.input model fields
        // Also check for early override configuration from LLMConfigurationManager
        const configManager = LLMConfigurationManager.getInstance();
        const hasOverride = configManager.hasOverride?.() || false;
        const overrideConfig = hasOverride ? configManager.getConfiguration() : null;

        // Handle input based on type - preserve arrays for conversation state
        let mergedInput: any;

        // Extract model configuration first (to be used for all input types)
        const modelConfig = params.model ? {
          // Extract nested model configuration properly
          main_model: (params.model.main_model as any)?.model || params.model.main_model,
          mini_model: (params.model.mini_model as any)?.model || params.model.mini_model,
          nano_model: (params.model.nano_model as any)?.model || params.model.nano_model,
          provider: (params.model.main_model as any)?.provider || params.model.provider,
          api_key: (params.model.main_model as any)?.api_key || (params.model as any).api_key,
          endpoint: (params.model.main_model as any)?.endpoint || (params.model as any)?.endpoint
        } : {};

        // Apply override configuration on top of model config
        const finalModelConfig = overrideConfig ? {
          provider: overrideConfig.provider || modelConfig.provider,
          api_key: overrideConfig.apiKey || modelConfig.api_key,
          main_model: overrideConfig.mainModel || modelConfig.main_model,
          mini_model: overrideConfig.miniModel || modelConfig.mini_model,
          nano_model: overrideConfig.nanoModel || modelConfig.nano_model,
          endpoint: overrideConfig.endpoint || modelConfig.endpoint
        } : modelConfig;

        if (Array.isArray(params.input)) {
          // Input is conversation array (OpenAI Responses API format)
          // Wrap array with model configuration so executeChatEvaluation can extract both
          mergedInput = {
            messages: params.input,  // Conversation array
            ...finalModelConfig       // Model configuration
          };
        } else {
          // Input is object or string - merge with model configuration
          mergedInput = {
            ...(typeof params.input === 'object' ? params.input : {}),
            ...finalModelConfig
          };
        }

        logger.info('DEBUG: Created merged input for chat evaluation', {
          evaluationId: params.evaluationId,
          hasOverrideConfig: !!overrideConfig,
          overrideConfig: overrideConfig ? {
            ...overrideConfig,
            apiKey: overrideConfig.apiKey ? `${overrideConfig.apiKey.substring(0, 10)}...` : undefined
          } : undefined,
          inputType: Array.isArray(params.input) ? 'conversation-array' : typeof params.input,
          messageCount: Array.isArray(params.input) ? params.input.length : mergedInput.messages?.length,
          mergedInput: {
            ...mergedInput,
            messages: mergedInput.messages ? `[array with ${mergedInput.messages.length} messages]` : undefined,
            api_key: mergedInput.api_key ? `${mergedInput.api_key.substring(0, 10)}...` : undefined
          }
        });
        
        toolResult = await this.executeChatEvaluation(
          mergedInput,
          params.timeout || 300000, // Default 5 minutes for chat
          tracingContext
        );
      } else {
        // Execute regular tool evaluation
        this.sendStatus(params.evaluationId, 'running', 0.5, `Executing ${params.tool}...`);
        
        toolResult = await this.executeToolWithTimeout(
          tool,
          params.input,
          params.timeout || 30000,
          tracingContext,
          params.tool
        );
      }

      const executionTime = Date.now() - startTime;

      // Send JSON-RPC success response
      const rpcResponse = createSuccessResponse(
        id,
        toolResult,
        executionTime,
        [{
          tool: params.tool,
          timestamp: new Date().toISOString(),
          duration: executionTime,
          status: 'success'
        }],
        {
          url: params.url,
          evaluationId: params.evaluationId
        }
      );

      if (this.client) {
        this.client.send(rpcResponse);
      }

      this.sendStatus(params.evaluationId, 'completed', 1.0, 'Evaluation completed successfully');

      // Update trace with success
      try {
        await this.tracingProvider.finalizeTrace(traceId, {
          output: toolResult,
          statusMessage: 'completed',
          metadata: {
            executionTime,
            evaluationId: params.evaluationId,
            ...(orchestratorDescriptor ? {
              agentVersion: orchestratorDescriptor.version,
              agentName: orchestratorDescriptor.name,
              promptHash: orchestratorDescriptor.promptHash,
              toolsetHash: orchestratorDescriptor.toolsetHash
            } : {})
          }
        });
      } catch (error) {
        logger.warn('Failed to update trace:', error);
      }

      logger.info('Evaluation completed successfully', {
        evaluationId: params.evaluationId,
        executionTime
      });

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error(`Evaluation failed: ${errorMessage} (evaluationId: ${params.evaluationId})`);

      // Send JSON-RPC error response
      const rpcResponse = createErrorResponse(
        id,
        ErrorCodes.TOOL_EXECUTION_ERROR,
        'Tool execution failed',
        {
          tool: params.tool,
          error: errorMessage,
          url: params.url,
          timestamp: new Date().toISOString()
        }
      );

      if (this.client) {
        this.client.send(rpcResponse);
      }

      this.sendStatus(params.evaluationId, 'failed', 1.0, errorMessage);

      // Update trace with error
      try {
        await this.tracingProvider.finalizeTrace(traceId, {
          error: errorMessage,
          statusMessage: 'failed',
          metadata: {
            executionTime,
            evaluationId: params.evaluationId,
            ...(orchestratorDescriptor ? {
              agentVersion: orchestratorDescriptor.version,
              agentName: orchestratorDescriptor.name,
              promptHash: orchestratorDescriptor.promptHash,
              toolsetHash: orchestratorDescriptor.toolsetHash
            } : {})
          }
        });
      } catch (updateError) {
        logger.warn('Failed to update trace with error:', updateError);
      }

    } finally {
      this.activeEvaluations.delete(params.evaluationId);

      // Clean up early override if we set one
      if (hasSetEarlyOverride) {
        try {
          const configManager = LLMConfigurationManager.getInstance();
          configManager.clearOverride();
          logger.info('Cleared early configuration override', { evaluationId: params.evaluationId });
        } catch (clearError) {
          logger.warn('Failed to clear early configuration override:', clearError);
        }
      }
    }
  }

  private async executeToolWithTimeout(
    tool: any,
    input: any,
    timeout: number,
    tracingContext?: TracingContext,
    toolName?: string
  ): Promise<any> {
    const spanId = `tool-exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = new Date();
    const toolDescriptor = tool instanceof ConfigurableAgentTool ? await AgentDescriptorRegistry.getDescriptor(tool.name) : null;
    
    // Create tool execution span if tracing context is provided
    if (tracingContext) {
      try {
        await this.tracingProvider.createObservation({
          id: spanId,
          name: `Tool: ${toolName || 'unknown'}`,
          type: 'span',
          startTime,
          input,
          metadata: {
            tool: toolName,
            timeout,
            ...(toolDescriptor ? {
              agentVersion: toolDescriptor.version,
              agentName: toolDescriptor.name,
              promptHash: toolDescriptor.promptHash,
              toolsetHash: toolDescriptor.toolsetHash
            } : {})
          }
        }, tracingContext.traceId);
      } catch (error) {
        logger.warn('Failed to create tool execution span:', error);
      }
    }
    
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Update span with timeout error
        if (tracingContext) {
          this.tracingProvider.updateObservation(spanId, {
            endTime: new Date(),
            error: `Tool execution timeout after ${timeout}ms`,
            metadata: toolDescriptor ? {
              agentVersion: toolDescriptor.version,
              agentName: toolDescriptor.name,
              promptHash: toolDescriptor.promptHash,
              toolsetHash: toolDescriptor.toolsetHash
            } : undefined
          }).catch(err => logger.warn('Failed to update span with timeout:', err));
        }
        reject(new Error(`Tool execution timeout after ${timeout}ms`));
      }, timeout);

      // Execute tool with tracing context if available
      const executePromise = tracingContext 
        ? withTracingContext(tracingContext, () => tool.execute(input))
        : tool.execute(input);
      
      executePromise
        .then((result: any) => {
          clearTimeout(timer);
          
          // Update span with success
          if (tracingContext) {
            this.tracingProvider.updateObservation(spanId, {
              endTime: new Date(),
              output: result,
              metadata: toolDescriptor ? {
                agentVersion: toolDescriptor.version,
                agentName: toolDescriptor.name,
                promptHash: toolDescriptor.promptHash,
                toolsetHash: toolDescriptor.toolsetHash
              } : undefined
            }).catch(err => logger.warn('Failed to update span with result:', err));
          }
          
          resolve(result);
        })
        .catch((error: Error) => {
          clearTimeout(timer);
          
          // Update span with error
          if (tracingContext) {
            this.tracingProvider.updateObservation(spanId, {
              endTime: new Date(),
              error: error.message,
              metadata: toolDescriptor ? {
                agentVersion: toolDescriptor.version,
                agentName: toolDescriptor.name,
                promptHash: toolDescriptor.promptHash,
                toolsetHash: toolDescriptor.toolsetHash
              } : undefined
            }).catch(err => logger.warn('Failed to update span with error:', err));
          }
          
          reject(error);
        });
    });
  }

  private sendStatus(
    evaluationId: string,
    status: 'running' | 'completed' | 'failed',
    progress?: number,
    message?: string
  ): void {
    if (!this.client || !this.ready) return;

    const statusMessage = createStatusMessage(
      evaluationId,
      status,
      progress,
      message
    );

    this.client.send(statusMessage);
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(() => {
      if (this.client && this.ready) {
        this.client.send({
          type: 'ping',
          timestamp: new Date().toISOString()
        });
      }
    }, 30000); // Send ping every 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  public getActiveEvaluationsCount(): number {
    return this.activeEvaluations.size;
  }

  public getActiveEvaluations(): string[] {
    return Array.from(this.activeEvaluations.keys());
  }

  /**
   * Convert OpenAI Responses API message array to internal ChatMessage format
   */
  private convertMessagesToChatMessages(messages: Array<{role: string, content: string}>): ChatMessage[] {
    return messages
      .filter(msg => msg.role !== 'system')  // System messages handled separately
      .map(msg => {
        if (msg.role === 'user') {
          return {
            entity: ChatMessageEntity.USER,
            text: msg.content
          } as ChatMessage;
        } else if (msg.role === 'assistant') {
          return {
            entity: ChatMessageEntity.MODEL,
            action: 'final' as const,
            answer: msg.content,
            isFinalAnswer: true
          } as ChatMessage;
        }
        return null;
      })
      .filter((msg): msg is ChatMessage => msg !== null);
  }

  /**
   * Extract system messages from message array
   */
  private extractSystemPrompt(messages: Array<{role: string, content: string}>): string | undefined {
    const systemMessages = messages.filter(msg => msg.role === 'system');
    return systemMessages.length > 0
      ? systemMessages.map(m => m.content).join('\n\n')
      : undefined;
  }

  private async executeChatEvaluation(
    input: any,
    timeout: number,
    tracingContext?: TracingContext
  ): Promise<any> {
    // Determine input format and extract message/messages
    let userMessage: string | undefined;
    let conversationHistory: ChatMessage[] | undefined;
    let systemPrompt: string | undefined;

    if (typeof input === 'string') {
      // Format 1: Direct string input
      userMessage = input;
    } else if (Array.isArray(input)) {
      // Format 2: Array of messages (OpenAI Responses API format)
      systemPrompt = this.extractSystemPrompt(input);
      conversationHistory = this.convertMessagesToChatMessages(input);
      // Extract the last user message as the current input
      const lastUserMsg = input.filter(m => m.role === 'user').pop();
      if (lastUserMsg) {
        userMessage = lastUserMsg.content;
      }
    } else if (input.message) {
      // Format 3: Object with message field (legacy format)
      userMessage = input.message;
    } else if (input.messages && Array.isArray(input.messages)) {
      // Format 4: Object with messages array field
      systemPrompt = this.extractSystemPrompt(input.messages);
      conversationHistory = this.convertMessagesToChatMessages(input.messages);
      const lastUserMsg = input.messages.filter((m: any) => m.role === 'user').pop();
      if (lastUserMsg) {
        userMessage = lastUserMsg.content;
      }
    }

    // Validate we got a user message and ensure it's a string
    if (!userMessage) {
      throw new Error('Chat evaluation requires a user message (either as string, input.message, or in messages array)');
    }

    if (typeof userMessage !== 'string') {
      throw new Error(`User message must be a string, got ${typeof userMessage}: ${JSON.stringify(userMessage)}`);
    }

    logger.info('Starting chat evaluation', {
      message: userMessage,
      inputType: typeof input === 'string' ? 'string' : Array.isArray(input) ? 'array' : 'object',
      hasConversationHistory: !!conversationHistory,
      historyLength: conversationHistory?.length || 0,
      hasSystemPrompt: !!systemPrompt,
      timeout,
      hasTracingContext: !!tracingContext
    });
    
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Chat evaluation timeout after ${timeout}ms`));
      }, timeout);

      let chatObservationId: string | undefined;
      // Get configuration manager for override support (defined outside try-catch for finally block)
      const configManager = LLMConfigurationManager.getInstance();
      const orchestratorDescriptor = await this.orchestratorDescriptorPromise;

      try {

        // Get or create AgentService instance
        const agentService = AgentService.getInstance();

        // Get current configuration as baseline
        const config = configManager.getConfiguration();

        // Extract model configuration from input
        // Note: input here may be the original string/array, OR the mergedInput object with model config
        // We need to handle both cases
        const inputConfig = (typeof input === 'object' && !Array.isArray(input)) ? input : {};

        // Consolidate configuration with proper fallbacks
        // Priority: input values (from mergedInput) -> existing config -> defaults
        const provider = inputConfig.provider || config.provider || 'openai';
        const mainModel = inputConfig.main_model || config.mainModel || this.judgeModel;
        const miniModel = inputConfig.mini_model ?? config.miniModel ?? this.miniModel;
        const nanoModel = inputConfig.nano_model ?? config.nanoModel ?? this.nanoModel;
        const apiKey = inputConfig.api_key ?? config.apiKey ?? agentService.getApiKey();
        const endpoint = inputConfig.endpoint ?? config.endpoint;

        logger.info('Setting consolidated configuration override for chat evaluation', {
          inputType: typeof input,
          isArray: Array.isArray(input),
          inputConfig: {
            ...inputConfig,
            api_key: inputConfig.api_key ? `${inputConfig.api_key.substring(0, 10)}...` : undefined
          },
          provider: provider,
          mainModel: mainModel,
          miniModel: miniModel,
          nanoModel: nanoModel,
          hasApiKey: !!apiKey,
          apiKeyPreview: apiKey ? `${apiKey.substring(0, 10)}...` : undefined,
          hasEndpoint: !!endpoint,
          isInitialized: agentService.isInitialized()
        });

        // Set single consolidated override with all fallback values
        const configOverride: any = {
          provider: provider,
          mainModel: mainModel,
          miniModel: miniModel,
          nanoModel: nanoModel,
          apiKey: apiKey || undefined,
          endpoint: endpoint || undefined
        };

        // Add system prompt if extracted from messages
        if (systemPrompt) {
          configOverride.systemPrompt = systemPrompt;
        }

        configManager.setOverride(configOverride);

        // Load conversation history if provided
        if (conversationHistory && conversationHistory.length > 0) {
          logger.info('Loading conversation history', { historyLength: conversationHistory.length });
          const state = agentService.getState();
          // Remove the last user message from history since sendMessage() will add it
          // This prevents duplication in the UI and LLM calls
          const historyWithoutLastUser = conversationHistory.filter(msg => {
            // Keep all model/assistant messages and all user messages except the last one
            if (msg.entity === ChatMessageEntity.MODEL) {
              return true;
            }
            // For user messages, only keep if it's not the last user message
            if (msg.entity === ChatMessageEntity.USER) {
              return msg.text !== userMessage;
            }
            return true; // Keep other message types
          });
          state.messages = [...historyWithoutLastUser];
          logger.info('Loaded history without last user message', {
            originalLength: conversationHistory.length,
            filteredLength: historyWithoutLastUser.length
          });
        }

        // Send the message using AgentService directly but with configuration override
        // The configuration override ensures it uses the API key from the request
        const finalMessage: ChatMessage = tracingContext
          ? await withTracingContext(tracingContext, () => agentService.sendMessage(userMessage!))
          : await agentService.sendMessage(userMessage!);
        
        // Create a child observation for the chat execution
        if (tracingContext) {
          chatObservationId = `chat-exec-${Date.now()}`;
          try {
            await this.tracingProvider.createObservation({
              id: chatObservationId,
              name: 'Chat Execution',
              type: 'span',
              startTime: new Date(),
              input: {
                message: userMessage,
                model: mainModel,
                hasConversationHistory: !!conversationHistory,
                hasSystemPrompt: !!systemPrompt
              },
              metadata: {
                evaluationType: 'chat',
                ...(orchestratorDescriptor ? {
                  agentVersion: orchestratorDescriptor.version,
                  agentName: orchestratorDescriptor.name,
                  promptHash: orchestratorDescriptor.promptHash,
                  toolsetHash: orchestratorDescriptor.toolsetHash
                } : {})
              }
            }, tracingContext.traceId);
          } catch (error) {
            logger.warn('Failed to create chat execution observation:', error);
          }
        }
        
        clearTimeout(timer);
        
        // Extract the response text from the final message
        let responseText = '';
        if ('answer' in finalMessage) {
          responseText = finalMessage.answer || '';
        } else if ('error' in finalMessage) {
          responseText = `Error: ${finalMessage.error}`;
        }
        
        // Update the chat execution observation with the result
        if (tracingContext && chatObservationId) {
          try {
            await this.tracingProvider.updateObservation(chatObservationId, {
              endTime: new Date(),
              output: { response: responseText, messageCount: agentService.getMessages().length },
              metadata: orchestratorDescriptor ? {
                evaluationType: 'chat',
                status: 'completed',
                agentVersion: orchestratorDescriptor.version,
                agentName: orchestratorDescriptor.name,
                promptHash: orchestratorDescriptor.promptHash,
                toolsetHash: orchestratorDescriptor.toolsetHash
              } : {
                evaluationType: 'chat',
                status: 'completed'
              }
            });
          } catch (error) {
            logger.warn('Failed to update chat execution observation:', error);
          }
        }
        
        // Build a response object similar to tool responses
        const result = {
          response: responseText,
          messages: agentService.getMessages(),
          modelUsed: mainModel,
          timestamp: new Date().toISOString(),
          evaluationMetadata: {
            evaluationType: 'chat',
            actualModelUsed: mainModel
          }
        };
        
        logger.info('Chat evaluation completed successfully', {
          responseLength: responseText.length,
          messageCount: result.messages.length,
          modelUsed: mainModel,
          evaluationId: tracingContext?.traceId
        });
        
        resolve(result);

      } catch (error) {
        clearTimeout(timer);
        
        // Update the chat execution observation with the error
        if (tracingContext && chatObservationId) {
          try {
            await this.tracingProvider.updateObservation(chatObservationId, {
              endTime: new Date(),
              error: error instanceof Error ? error.message : String(error),
              metadata: orchestratorDescriptor ? {
                evaluationType: 'chat',
                status: 'failed',
                agentVersion: orchestratorDescriptor.version,
                agentName: orchestratorDescriptor.name,
                promptHash: orchestratorDescriptor.promptHash,
                toolsetHash: orchestratorDescriptor.toolsetHash
              } : {
                evaluationType: 'chat',
                status: 'failed'
              }
            });
          } catch (updateError) {
            logger.warn('Failed to update chat execution observation with error:', updateError);
          }
        }

        logger.error('Chat evaluation failed:', error);
        reject(error);
      } finally {
        // Clear configuration override after evaluation
        configManager.clearOverride();
      }
    });
  }

  /**
   * Handle LLM configuration requests for persistent configuration
   */
  private async handleLLMConfigurationRequest(request: LLMConfigurationRequest): Promise<void> {
    const { params, id } = request;

    logger.info('Received LLM configuration request', {
      provider: params.provider,
      hasApiKey: !!params.apiKey,
      models: params.models,
      partial: params.partial
    });

    try {
      // Get configuration manager
      const configManager = LLMConfigurationManager.getInstance();

      // Store current config for potential rollback
      const currentConfig = configManager.loadConfiguration();

      // Handle configuration update based on partial flag
      if (params.partial) {
        // Use the new partial configuration method
        const partialConfig: Partial<LLMConfig> = {};
        if (params.provider !== undefined) partialConfig.provider = params.provider;
        if (params.apiKey !== undefined) partialConfig.apiKey = params.apiKey;
        if (params.endpoint !== undefined) partialConfig.endpoint = params.endpoint;
        if (params.models?.main !== undefined) partialConfig.mainModel = params.models.main;
        if (params.models?.mini !== undefined) partialConfig.miniModel = params.models.mini;
        if (params.models?.nano !== undefined) partialConfig.nanoModel = params.models.nano;

        configManager.applyPartialConfiguration(partialConfig);
      } else {
        // Full configuration update
        const fullConfig: LLMConfig = {
          provider: params.provider,
          apiKey: params.apiKey,
          endpoint: params.endpoint,
          mainModel: params.models.main,
          miniModel: params.models?.mini,
          nanoModel: params.models?.nano
        };
        configManager.saveConfiguration(fullConfig);
      }

      // Validate the saved configuration
      const postSaveValidation = configManager.validateConfiguration();

      if (!postSaveValidation.isValid) {
        // Restore the original config if validation fails
        configManager.saveConfiguration(currentConfig);

        // Send error response with validation errors
        const errorResponse = createErrorResponse(
          id,
          ErrorCodes.INVALID_PARAMS,
          'Invalid configuration',
          { errors: postSaveValidation.errors }
        );

        if (this.client) {
          this.client.send(errorResponse);
        }

        logger.error('Configuration validation failed', {
          errors: postSaveValidation.errors
        });

        return;
      }

      // Reinitialize AgentService with new configuration
      const agentService = AgentService.getInstance();
      await agentService.refreshCredentials();

      // Get the applied configuration
      const appliedConfiguration = configManager.loadConfiguration();

      // Prepare response with applied configuration
      const appliedConfig = {
        provider: appliedConfiguration.provider,
        models: {
          main: appliedConfiguration.mainModel,
          mini: appliedConfiguration.miniModel || '',
          nano: appliedConfiguration.nanoModel || ''
        }
      };

      // Send success response
      const response = createLLMConfigurationResponse(id, appliedConfig);

      if (this.client) {
        this.client.send(response);
      }

      logger.info('LLM configuration applied successfully', {
        provider: appliedConfiguration.provider,
        mainModel: appliedConfiguration.mainModel
      });

    } catch (error) {
      logger.error('Failed to apply LLM configuration:', error);

      // Send error response
      const errorResponse = createErrorResponse(
        id,
        ErrorCodes.INTERNAL_ERROR,
        'Failed to apply LLM configuration',
        {
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        }
      );

      if (this.client) {
        this.client.send(errorResponse);
      }
    }
  }

  /**
   * Handle direct tool execution requests without LLM orchestration
   */
  private async handleToolExecutionRequest(request: ToolExecutionRequest): Promise<void> {
    const { params, id } = request;
    const startTime = Date.now();

    logger.info('Received tool execution request', {
      tool: params.tool,
      hasArgs: !!params.args,
      timeout: params.timeout || 30000
    });

    try {
      // Get the tool from registry
      const tool = ToolRegistry.getRegisteredTool(params.tool);
      if (!tool) {
        const errorResponse = createToolExecutionErrorResponse(
          id,
          ErrorCodes.INVALID_PARAMS,
          `Tool not found: ${params.tool}`,
          params.tool,
          `Tool '${params.tool}' is not registered`
        );
        if (this.client) {
          this.client.send(errorResponse);
        }
        logger.error('Tool not found', { tool: params.tool });
        return;
      }

      // Execute the tool with timeout
      const timeout = params.timeout || 30000;
      const result = await this.executeToolWithTimeout(
        tool,
        params.args || {},
        timeout,
        undefined,
        params.tool
      );

      const executionTime = Date.now() - startTime;

      // Send success response
      const successResponse = createToolExecutionSuccessResponse(
        id,
        params.tool,
        result,
        executionTime
      );

      if (this.client) {
        this.client.send(successResponse);
      }

      logger.info('Tool execution completed', {
        tool: params.tool,
        executionTime,
        hasResult: !!result
      });

    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('Tool execution failed', {
        tool: params.tool,
        error: error instanceof Error ? error.message : String(error),
        executionTime
      });

      const errorResponse = createToolExecutionErrorResponse(
        id,
        ErrorCodes.INTERNAL_ERROR,
        'Tool execution failed',
        params.tool,
        error instanceof Error ? error.message : String(error)
      );

      if (this.client) {
        this.client.send(errorResponse);
      }
    }
  }
}
