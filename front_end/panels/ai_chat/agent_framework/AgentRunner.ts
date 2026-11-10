// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { enhancePromptWithPageContext } from '../core/PageInfoManager.js';
import type { AgentDescriptor } from '../core/AgentDescriptorRegistry.js';
import { LLMClient } from '../LLM/LLMClient.js';
import type { LLMResponse, LLMMessage, LLMProvider } from '../LLM/LLMTypes.js';
import type { Tool } from '../tools/Tools.js';
import { ChatMessageEntity, type ChatMessage, type ModelChatMessage, type ToolResultMessage } from '../models/ChatTypes.js';
import { createLogger } from '../core/Logger.js';
import { createTracingProvider, getCurrentTracingContext } from '../tracing/TracingConfig.js';
import type { AgentSession, AgentMessage } from './AgentSessionTypes.js';
import { AgentErrorHandler } from '../core/AgentErrorHandler.js';
import { AgentRunnerEventBus } from './AgentRunnerEventBus.js';
import { callLLMWithTracing } from '../tools/LLMTracingWrapper.js';
import { sanitizeMessagesForModel } from '../LLM/MessageSanitizer.js';
import { FileStorageManager } from '../tools/FileStorageManager.js';
import { getRuntime } from './RuntimeContext.js';

const logger = createLogger('AgentRunner');

import { ConfigurableAgentTool, ToolRegistry, type ConfigurableAgentArgs, type ConfigurableAgentResult, type AgentRunTerminationReason, type HandoffConfig /* , HandoffContextTransform, ContextFilterRegistry*/ } from './ConfigurableAgentTool.js';
import { MODEL_SENTINELS } from '../core/Constants.js';

/**
 * Configuration for the AgentRunner
 */
export interface AgentRunnerConfig {
  apiKey: string;
  modelName: string;
  systemPrompt: string;
  tools: Array<Tool<any, any>>;
  maxIterations: number;
  temperature?: number;
  /** Selected LLM provider for this run (required) */
  provider: LLMProvider;
  /** Optional vision capability check. Defaults to false (no vision). */
  getVisionCapability?: (modelName: string) => Promise<boolean> | boolean;
  /** Mini model for smaller/faster operations */
  miniModel?: string;
  /** Nano model for smallest/fastest operations */
  nanoModel?: string;
  /** Descriptor describing this agent configuration */
  agentDescriptor?: AgentDescriptor;
  /** CDP session adapter for browser interactions (enables running outside DevTools) */
  cdpAdapter?: import('../cdp/CDPSessionAdapter.js').CDPSessionAdapter;
  /** Called before each tool execution (for logging/debugging) */
  onBeforeToolExecution?: (toolName: string, toolArgs: unknown) => Promise<void>;
}

/**
 * Hooks for customizing AgentRunner behavior
 */
export interface AgentRunnerHooks {
  /** Function to potentially modify messages before the first LLM call */
  prepareInitialMessages?: (messages: ChatMessage[]) => ChatMessage[];
  /** Function to create a success result */
  createSuccessResult: (output: string, intermediateSteps: ChatMessage[], reason: AgentRunTerminationReason) => ConfigurableAgentResult;
  /** Function to create an error result */
  createErrorResult: (error: string, intermediateSteps: ChatMessage[], reason: AgentRunTerminationReason) => ConfigurableAgentResult;
  /** Function to run after agent execution completes (optional) */
  afterExecute?: (result: ConfigurableAgentResult, agentSession: AgentSession) => Promise<void>;
}


/**
 * Runs the core agent execution loop
 */
export class AgentRunner {
  private static eventBus: AgentRunnerEventBus | null = null;

  /**
   * Track cleanup operations in progress to prevent race conditions.
   * Uses a Set to track which cleanup operations are currently running.
   */
  private static cleanupInProgress = new Set<string>();

  /**
   * Initialize event bus connection
   */
  static initializeEventBus(): void {
    if (!AgentRunner.eventBus) {
      AgentRunner.eventBus = AgentRunnerEventBus.getInstance();
    }
  }

  /**
   * Clears the todo list file if it exists and has content.
   * Called when an agent completes or fails to clean up state.
   * Only clears if the agent has access to the update_todo tool.
   *
   * This method is idempotent and race-condition safe:
   * - Uses a lock to prevent concurrent cleanup operations
   * - Handles "file not found" errors gracefully (another agent may have deleted it)
   */
  private static async clearTodoList(agentName: string, tools: Array<Tool<any, any>>): Promise<void> {
    // Only clear todos if the agent has the update_todo tool
    const hasUpdateTodoTool = tools.some(tool => tool.name === 'update_todo');
    if (!hasUpdateTodoTool) {
      logger.debug(`Agent ${agentName} does not have update_todo tool, skipping todo list cleanup`);
      return;
    }

    // Use a unique key for the cleanup lock (todos.md is shared across all agents)
    const cleanupKey = 'todos.md';

    // Check if cleanup is already in progress - skip if so
    if (AgentRunner.cleanupInProgress.has(cleanupKey)) {
      logger.debug(`Cleanup already in progress for ${cleanupKey}, skipping for ${agentName}`);
      return;
    }

    // Acquire the cleanup lock
    AgentRunner.cleanupInProgress.add(cleanupKey);

    try {
      const fileManager = FileStorageManager.getInstance();
      const todosFile = await fileManager.readFile('todos.md');

      if (todosFile?.content && todosFile.content.trim().length > 0) {
        try {
          await fileManager.deleteFile('todos.md');
          logger.info(`Cleared non-empty todo list for ${agentName}`);
        } catch (deleteError) {
          // Handle race condition: file may have been deleted by another agent
          const errorMessage = deleteError instanceof Error ? deleteError.message : String(deleteError);
          if (errorMessage.includes('was not found')) {
            logger.debug(`Todo list already deleted by another agent, skipping for ${agentName}`);
          } else {
            // Re-throw unexpected errors
            throw deleteError;
          }
        }
      }
    } catch (error) {
      logger.debug(`Failed to clear todo list for ${agentName}:`, error);
    } finally {
      // Always release the cleanup lock
      AgentRunner.cleanupInProgress.delete(cleanupKey);
    }
  }

  /**
   * Helper function to convert ChatMessage[] to LLMMessage[]
   */
  private static convertToLLMMessages(messages: ChatMessage[]): LLMMessage[] {
    const llmMessages: LLMMessage[] = [];

    for (const msg of messages) {
      // Skip AGENT_SESSION messages - they are for UI only
      if (msg.entity === ChatMessageEntity.AGENT_SESSION) {
        continue;
      }
      
      if (msg.entity === ChatMessageEntity.USER) {
        // User message
        if ('text' in msg) {
          llmMessages.push({
            role: 'user',
            content: msg.text,
          });
        }
      } else if (msg.entity === ChatMessageEntity.MODEL) {
        // Model message
        const modelMsg = msg as ModelChatMessage;
        if (modelMsg.action === 'final' && modelMsg.answer) {
          llmMessages.push({
            role: 'assistant',
            content: modelMsg.answer,
          });
        } else if (modelMsg.action === 'tool' && modelMsg.toolCallId) {
          // Tool call message
          llmMessages.push({
            role: 'assistant',
            content: undefined,
            tool_calls: [{
              id: modelMsg.toolCallId,
              type: 'function',
              function: {
                name: modelMsg.toolName || '',
                arguments: JSON.stringify(modelMsg.toolArgs || {}),
              }
            }],
          });
        }
      } else if (msg.entity === ChatMessageEntity.TOOL_RESULT) {
        // Tool result message
        const toolResult = msg as ToolResultMessage;
        if (toolResult.toolCallId && toolResult.resultText) {

          // Check if tool result includes image data
          const hasImageData = toolResult.imageData && typeof toolResult.imageData === 'string';

          if (hasImageData) {
            // Create multimodal content (text + image)
            llmMessages.push({
              role: 'tool',
              content: [
                {
                  type: 'text',
                  text: toolResult.resultText
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: toolResult.imageData!,  // Safe to use ! since we checked hasImageData
                    detail: 'high' // Use high detail for tool-generated images
                  }
                }
              ],
              tool_call_id: toolResult.toolCallId,
            });
          } else {
            // Text-only behavior for tools without images
            let content = toolResult.resultText;

            // Append summary if present
            if (toolResult.summary) {
              content = content + '\n\n' + toolResult.summary;
            }

            llmMessages.push({
              role: 'tool',
              content: content,
              tool_call_id: toolResult.toolCallId,
            });
          }
        }
      }
    }

    return llmMessages;
  }

  /**
   * Sanitizes tool result data for text representation by removing fields
   * that shouldn't be sent to the LLM (imageData, success, etc.)
   */
  private static sanitizeToolResultForText(toolResultData: any): any {
    if (typeof toolResultData !== 'object' || toolResultData === null) {
      return toolResultData;
    }

    // Create a shallow copy
    const sanitized = { ...toolResultData };

    // Remove fields that shouldn't be sent to LLM
    const fieldsToRemove = [
      'imageData',    // Prevents token waste from base64 strings
      'success',      // LLM should infer success from error presence
      'dataUrl',      // Legacy image field if any
      'agentSession', // Avoid sending session data to LLM
    ];

    fieldsToRemove.forEach(field => {
      if (sanitized.hasOwnProperty(field)) {
        delete sanitized[field];
      }
    });

    return sanitized;
  }

  /**
   * Prune old accessibility tree results to save tokens.
   * Keeps only the last 2 get_page_content results intact.
   * Older results are replaced with a redaction notice.
   *
   * This prevents context overflow when the agent repeatedly calls get_page_content
   * on large pages, as each call can add 40k+ tokens to the conversation history.
   */
  private static pruneAccessibilityTreeHistory(messages: ChatMessage[]): ChatMessage[] {
    // Find all get_page_content tool results
    const treeResultIndices: number[] = [];
    messages.forEach((msg, i) => {
      if (msg.entity === ChatMessageEntity.TOOL_RESULT &&
          (msg as ToolResultMessage).toolName === 'get_page_content') {
        treeResultIndices.push(i);
      }
    });

    // If 2 or fewer, no pruning needed
    if (treeResultIndices.length <= 2) {
      return messages;
    }

    logger.info(`Pruning ${treeResultIndices.length - 2} old accessibility tree results to save tokens`);

    // Clone messages and redact old tree results (keep last 2)
    const indicesToRedact = new Set(treeResultIndices.slice(0, -2));
    const pruned = messages.map((msg, i) => {
      if (indicesToRedact.has(i)) {
        const original = msg as ToolResultMessage;
        return {
          ...original,
          resultText: '[Accessibility tree redacted to save tokens. Use get_page_content to fetch again if needed.]',
          resultData: { redacted: true },
        } as ToolResultMessage;
      }
      return msg;
    });

    return pruned;
  }

  /**
   * Compute the tool result text shown to the LLM for regular tool outputs (non-ConfigurableAgentResult).
   * Applies sanitization and chooses a placeholder if the result only contained an image payload.
   */
  static computeToolResultText(toolResultData: any, imageData?: string): string {
    // If the tool produced a simple string, return as-is
    if (typeof toolResultData === 'string') {
      return toolResultData;
    }
    // Create sanitized data for text representation (exclude large/non-LLM fields)
    const sanitizedData = this.sanitizeToolResultForText(toolResultData);
    const sanitizedIsEmptyObject = typeof sanitizedData === 'object' && sanitizedData !== null && Object.keys(sanitizedData).length === 0;
    const hadOnlyImage = !!imageData && sanitizedIsEmptyObject;
    if (hadOnlyImage) {
      return 'Image omitted (model lacks vision).';
    }
    return JSON.stringify(sanitizedData, null, 2);
  }

  // Helper function to execute the handoff logic (to avoid duplication)
  private static async executeHandoff(
    currentMessages: ChatMessage[],
    originalArgs: ConfigurableAgentArgs,
    handoffConfig: HandoffConfig,
    executingAgent: ConfigurableAgentTool,
    apiKey: string,
    defaultModelName: string,
    defaultMaxIterations: number,
    defaultTemperature: number,
    defaultCreateSuccessResult: AgentRunnerHooks['createSuccessResult'],
    defaultCreateErrorResult: AgentRunnerHooks['createErrorResult'],
    llmToolArgs?: ConfigurableAgentArgs, // Specific args if triggered by LLM tool call
    parentSession?: AgentSession, // For natural nesting
    defaultProvider?: LLMProvider,
    defaultGetVisionCapability?: (modelName: string) => Promise<boolean> | boolean,
    miniModel?: string, // Mini model for smaller/faster operations
    nanoModel?: string, // Nano model for smallest/fastest operations
    overrides?: { sessionId?: string; parentSessionId?: string; traceId?: string },
    onBeforeToolExecution?: (toolName: string, toolArgs: unknown) => Promise<void>
  ): Promise<ConfigurableAgentResult & { agentSession: AgentSession }> {
    const targetAgentName = handoffConfig.targetAgentName;
    const targetAgentTool = ToolRegistry.getRegisteredTool(targetAgentName);

    if (!(targetAgentTool instanceof ConfigurableAgentTool)) {
      const errorMsg = `Handoff target '${targetAgentName}' not found or is not a ConfigurableAgentTool.`;
      logger.error(`${errorMsg}`);
      // Create a minimal session for the error case
      const errorSession: AgentSession = {
        agentName: targetAgentName,
        sessionId: getRuntime().generateId(),
        status: 'error',
        startTime: getRuntime().now(),
        endTime: getRuntime().now(),
        messages: [],
        nestedSessions: [],
        tools: [],
        terminationReason: 'error'
      };
      // Use the default error creator from the initiating agent's context
      return { ...defaultCreateErrorResult(errorMsg, currentMessages, 'error'), agentSession: errorSession };
    }

    logger.info(`Initiating handoff from ${executingAgent.name} to ${targetAgentTool.name} (Trigger: ${handoffConfig.trigger || 'llm_tool_call'})`);

    let handoffMessages: ChatMessage[] = []; // Initialize handoff messages
    const targetConfig = targetAgentTool.config;

    // Determine the messages to hand off based on includeToolResults
    if (handoffConfig.includeToolResults && handoffConfig.includeToolResults.length > 0) {
      // Filter messages: keep user messages, final answers, and only tool calls/results for specified tools
      logger.info(`Filtering messages for handoff to ${targetAgentTool.name} based on includeToolResults.`);
      handoffMessages = currentMessages.filter(message => {
        // Always exclude AGENT_SESSION messages - they are for UI only
        if (message.entity === ChatMessageEntity.AGENT_SESSION) {
          return false;
        }
        if (message.entity === ChatMessageEntity.USER) {
          return true; // Always include user messages
        }
        if (message.entity === ChatMessageEntity.MODEL) {
          const modelMsg = message as ModelChatMessage;
          if (modelMsg.action === 'final') {
            return true; // Always include final answers
          }
          if (modelMsg.action === 'tool' && modelMsg.toolName) {
            return handoffConfig.includeToolResults!.includes(modelMsg.toolName); // Include tool calls for specified tools
          }
        }
        if (message.entity === ChatMessageEntity.TOOL_RESULT) {
          const toolResult = message as ToolResultMessage;
          return !toolResult.isError && toolResult.toolName && handoffConfig.includeToolResults!.includes(toolResult.toolName); // Include tool results for specified tools
        }
        return false; // Exclude other message types
      });
    } else {
      // No filter specified: pass the entire message history (but still exclude AGENT_SESSION messages)
      logger.info(`Passing filtered message history for handoff to ${targetAgentTool.name}.`);
      handoffMessages = currentMessages.filter(message => {
        // Always exclude AGENT_SESSION messages - they are for UI only
        return message.entity !== ChatMessageEntity.AGENT_SESSION;
      });
    }

    // Enhance the target agent's system prompt with page context
    const enhancedSystemPrompt = await enhancePromptWithPageContext(targetConfig.systemPrompt);

    // Resolve model name for the target agent
    let resolvedModelName: string;
    if (typeof targetConfig.modelName === 'function') {
      resolvedModelName = targetConfig.modelName();
    } else if (targetConfig.modelName === MODEL_SENTINELS.USE_MINI) {
      if (!miniModel) {
        throw new Error(`Mini model not provided for handoff to agent '${targetAgentName}'. Ensure miniModel is passed in context.`);
      }
      resolvedModelName = miniModel;
    } else if (targetConfig.modelName === MODEL_SENTINELS.USE_NANO) {
      if (!nanoModel) {
        throw new Error(`Nano model not provided for handoff to agent '${targetAgentName}'. Ensure nanoModel is passed in context.`);
      }
      resolvedModelName = nanoModel;
    } else {
      resolvedModelName = targetConfig.modelName || defaultModelName;
    }

    // Construct Runner Config & Hooks for the target agent
    const targetRunnerConfig: AgentRunnerConfig = {
      apiKey,
      modelName: resolvedModelName,
      systemPrompt: enhancedSystemPrompt,
      tools: targetConfig.tools
              .map(toolName => ToolRegistry.getRegisteredTool(toolName))
              .filter((tool): tool is Tool<any, any> => tool !== null),
      maxIterations: targetConfig.maxIterations || defaultMaxIterations,
      temperature: targetConfig.temperature ?? defaultTemperature,
      provider: defaultProvider as LLMProvider,
      getVisionCapability: defaultGetVisionCapability,
      miniModel,
      nanoModel,
      onBeforeToolExecution,
    };
    const targetRunnerHooks: AgentRunnerHooks = {
      prepareInitialMessages: undefined, // History already formed by transform or passthrough
      createSuccessResult: targetConfig.createSuccessResult
          ? (out, steps, reason) => targetConfig.createSuccessResult!(out, steps, reason, targetConfig)
          : defaultCreateSuccessResult, // Fallback to original runner's hook creator
      createErrorResult: targetConfig.createErrorResult
          ? (err, steps, reason) => targetConfig.createErrorResult!(err, steps, reason, targetConfig)
          : defaultCreateErrorResult, // Fallback to original runner's hook creator
    };

    // Determine args for the target agent: use llmToolArgs if provided, otherwise originalArgs
    const targetAgentArgs = llmToolArgs ?? originalArgs;

    logger.info(`Executing handoff target agent: ${targetAgentTool.name} with ${handoffMessages.length} messages.`);
    const handoffResult = await AgentRunner.run(
        handoffMessages,
        targetAgentArgs, // Use determined args
        targetRunnerConfig, // Pass the constructed config
        targetRunnerHooks,  // Pass the constructed hooks
        targetAgentTool, // Target agent is now the executing agent
        parentSession, // Pass parent session for natural nesting
        overrides
    );

    // Extract the result and session
    const { agentSession: childSession, ...actualResult } = handoffResult;

    // Add child session to parent's nested sessions (natural nesting)
    if (parentSession) {
      parentSession.nestedSessions.push(childSession);
    }

    logger.info(`Handoff target agent ${targetAgentTool.name} finished. Result success: ${actualResult.success}`);

    // Check if the target agent is configured to *include* intermediate steps
    if (targetAgentTool instanceof ConfigurableAgentTool && targetAgentTool.config.includeIntermediateStepsOnReturn === true) {
      // Combine message history if the target agent requests it
      logger.info(`Including intermediateSteps from ${targetAgentTool.name} based on its config.`);
      const combinedIntermediateSteps = [
          ...currentMessages, // History *before* the recursive call
          ...(actualResult.intermediateSteps || []) // History *from* the recursive call (should exist if flag is true)
      ];
      // Return the result from the target agent, but with combined history
      // Always use 'handed_off' since this IS a handoff completion
      return {
          ...actualResult,
          intermediateSteps: combinedIntermediateSteps,
          terminationReason: 'handed_off' as const,
          agentSession: childSession
      };
    }
    // Otherwise (default), omit the target's intermediate steps
    logger.info(`Omitting intermediateSteps from ${targetAgentTool.name} based on its config (default or flag set to false).`);
    // Return result from target, ensuring intermediateSteps are omitted
    // Always use 'handed_off' since this IS a handoff completion
    const finalResult = {
      ...actualResult,
      terminationReason: 'handed_off' as const,
      agentSession: childSession
    };
    // Explicitly delete intermediateSteps if they somehow exist on actualResult (shouldn't due to target config)
    delete finalResult.intermediateSteps;
    return finalResult;

  }

  static async run(
    initialMessages: ChatMessage[],
    args: ConfigurableAgentArgs,
    config: AgentRunnerConfig,
    hooks: AgentRunnerHooks,
    executingAgent: ConfigurableAgentTool | null,
    parentSession?: AgentSession, // For natural nesting
    overrides?: { sessionId?: string; parentSessionId?: string; traceId?: string; background?: boolean },
    abortSignal?: AbortSignal
  ): Promise<ConfigurableAgentResult & { agentSession: AgentSession }> {
    const agentName = executingAgent?.name || 'Unknown';
    logger.info(`Starting execution loop for agent: ${agentName}`);
    const { apiKey, modelName, systemPrompt, tools, maxIterations, temperature, agentDescriptor } = config;
    const isBackground = overrides?.background === true;
    const { prepareInitialMessages, createSuccessResult, createErrorResult, afterExecute } = hooks;


    // Create session when agent starts (natural timing)
    const agentSession: AgentSession = {
      agentName,
      agentQuery: args.query,
      agentReasoning: args.reasoning,
      agentDisplayName: executingAgent?.config?.ui?.displayName || agentName,
      agentDescription: executingAgent?.config?.description,
      sessionId: overrides?.sessionId || getRuntime().generateId(),
      parentSessionId: overrides?.parentSessionId || parentSession?.sessionId,
      status: 'running',
      startTime: getRuntime().now(),
      messages: [],
      nestedSessions: [], // Child sessions nest here naturally
      tools: config.tools.map(t => t.name),
      config: executingAgent?.config,
      maxIterations,
      modelUsed: modelName,
      iterationCount: 0,
      descriptor: agentDescriptor,
      // Initialize native metrics tracking
      metrics: {
        llmCallCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        toolCallCount: 0,
        toolCallsByName: {},
      },
    };

    // Use local session variable instead of static
    let currentSession = agentSession;
    
    // Emit session started event (skip for background agents)
    AgentRunner.eventBus?.emitProgress({
      type: 'session_started',
      sessionId: agentSession.sessionId,
      parentSessionId: agentSession.parentSessionId,
      agentName,
      timestamp: getRuntime().now(),
      data: { session: agentSession }
    }, isBackground);
    
    // Create local function that captures the correct session
    const addSessionMessage = (message: Partial<AgentMessage>): void => {
      const fullMessage: AgentMessage = {
        id: getRuntime().generateId(),
        timestamp: getRuntime().now(),
        ...message
      } as AgentMessage;
      
      currentSession.messages.push(fullMessage);
      
      // Emit progress events based on message type (skip for background agents)
      if (fullMessage.type === 'tool_call') {
        AgentRunner.eventBus?.emitProgress({
          type: 'tool_started',
          sessionId: currentSession.sessionId,
          parentSessionId: currentSession.parentSessionId,
          agentName: currentSession.agentName,
          timestamp: getRuntime().now(),
          data: {
            session: currentSession,
            toolCall: fullMessage
          }
        }, isBackground);
      } else if (fullMessage.type === 'tool_result') {
        AgentRunner.eventBus?.emitProgress({
          type: 'tool_completed',
          sessionId: currentSession.sessionId,
          parentSessionId: currentSession.parentSessionId,
          agentName: currentSession.agentName,
          timestamp: getRuntime().now(),
          data: {
            session: currentSession,
            toolResult: fullMessage
          }
        }, isBackground);
      }
    };

    let messages = [...initialMessages];

    // Prepare initial messages if hook provided
    if (prepareInitialMessages) {
      messages = prepareInitialMessages(messages);
    }

    const toolMap = new Map(tools.map(tool => [tool.name, tool]));
    const toolSchemas = tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.schema
      }
    }));

    // Create centralized error handler
    const errorHandler = AgentErrorHandler.createErrorHandler({
      continueOnError: true,
      agentName,
      availableTools: Array.from(toolMap.keys()),
      session: agentSession
    });

    // Add handoff tools based on the executing agent's config
    if (executingAgent?.config.handoffs) {
        // Iterate over the configured handoffs
        for (const handoffConfig of executingAgent.config.handoffs) {
            // Only add handoffs triggered by LLM tool calls to the schema
            if (!handoffConfig.trigger || handoffConfig.trigger === 'llm_tool_call') {
                const targetAgentName = handoffConfig.targetAgentName;
                const targetTool = ToolRegistry.getRegisteredTool(targetAgentName);
                if (targetTool instanceof ConfigurableAgentTool) {
                    const handoffToolName = `handoff_to_${targetAgentName}`;
                    toolSchemas.push({
                      type: 'function',
                      function: {
                        name: handoffToolName,
                        description: `Handoff the current task to the specialized agent: ${targetAgentName}. Use this agent when the task requires ${targetAgentName}'s capabilities. Agent Description: ${targetTool.description}`,
                        parameters: targetTool.schema // Use target agent's input schema
                      }
                    });
                     // Add a mapping for the handoff tool 'name' to the actual target tool instance
                     // This allows us to find the target agent later when this tool is called.
                    toolMap.set(handoffToolName, targetTool);
                    logger.info(`Added LLM handoff tool schema: ${handoffToolName}`);
                } else {
                  logger.warn(`Configured LLM handoff target '${targetAgentName}' not found or is not a ConfigurableAgentTool.`);
                }
            }
        }
    }

    // Capture initial reasoning from args if provided
    if (args.reasoning) {
      const reasoningText = Array.isArray(args.reasoning) ? args.reasoning.join(' ') : args.reasoning;
      addSessionMessage({
        type: 'reasoning',
        content: {
          type: 'reasoning',
          text: reasoningText
        }
      });
    }

    let iteration = 0; // Initialize iteration counter

    for (iteration = 0; iteration < maxIterations; iteration++) {
      // Check if execution has been aborted
      if (abortSignal?.aborted) {
        logger.info(`${agentName} execution aborted at iteration ${iteration + 1}/${maxIterations}`);

        // Complete session with abort
        currentSession.status = 'error';
        currentSession.endTime = getRuntime().now();
        currentSession.terminationReason = 'error';

        // Emit session completed event (skip for background agents)
        AgentRunner.eventBus?.emitProgress({
          type: 'session_completed',
          sessionId: currentSession.sessionId,
          parentSessionId: currentSession.parentSessionId,
          agentName,
          timestamp: getRuntime().now(),
          data: { session: currentSession, reason: 'aborted' }
        }, isBackground);

        // Clear todo list on abort
        await AgentRunner.clearTodoList(agentName, tools);

        const abortResult = createErrorResult('Execution was cancelled', messages, 'error');

        // Execute afterExecute hook if defined
        if (afterExecute) {
          try {
            await afterExecute(abortResult, currentSession);
          } catch (error) {
            logger.warn(`afterExecute hook failed for ${agentName}:`, error);
          }
        }

        return { ...abortResult, agentSession: currentSession };
      }

      // Update session iteration count
      if (currentSession) {
        currentSession.iterationCount = iteration + 1;
      }
      logger.info(`${agentName} Iteration ${iteration + 1}/${maxIterations}`);

      // Prepare prompt and call LLM
      const iterationInfo = `
## Current Progress
- You are currently on step ${iteration + 1} of ${maxIterations - 1} maximum steps.
- Focus on making meaningful progress with each step.`;

      // Inject todos into system prompt ONLY if agent has update_todo tool
      let todosContext = '';
      const hasUpdateTodoTool = config.tools.some(tool => tool.name === 'update_todo');

      if (hasUpdateTodoTool) {
        try {
          const fileManager = FileStorageManager.getInstance();
          const todosFile = await fileManager.readFile('todos.md');

          if (todosFile?.content) {
            todosContext = `\n\n## CURRENT TODO LIST\n${todosFile.content}\n\nUpdate the todo list using the 'update_todo' tool as you complete tasks. Mark completed items with [x].`;
          } else {
            todosContext = `\n\n## TODO LIST\nNo todo list exists yet. If this is a multi-step task, create a todo list using the 'update_todo' tool to track your progress.`;
          }
        } catch (error) {
          logger.debug('Failed to read todos, skipping injection:', error);
          // Continue without todos if reading fails
        }
      } else {
        logger.debug(`Skipping todo injection for ${agentName} - update_todo tool not available`);
      }

      // Enhance system prompt with iteration info, todos, and page context
      // This includes updating the accessibility tree inside enhancePromptWithPageContext
      const currentSystemPrompt = await enhancePromptWithPageContext(systemPrompt + iterationInfo + todosContext);

      let llmResponse: LLMResponse;
      let generationId: string | undefined; // Declare in iteration scope for tool call access

      try {
        logger.info(`${agentName} Calling LLM with ${messages.length} messages`);

        // Get enhanced tracing context for AgentRunner LLM generation
        const tracingContext = getCurrentTracingContext();
        const tracingProvider = createTracingProvider();
        const generationStartTime = getRuntime().now();

        logger.debug(`[HIERARCHICAL_TRACING] AgentRunner: Starting LLM generation for ${agentName}:`, {
          hasTracingContext: !!tracingContext,
          traceId: tracingContext?.traceId,
          currentAgentSpanId: tracingContext?.currentAgentSpanId,
          parentObservationId: tracingContext?.parentObservationId,
          executionLevel: tracingContext?.executionLevel,
          iteration: iteration + 1
        });

        // Create generation observation for AgentRunner LLM call
        if (tracingContext?.traceId) {
          generationId = `gen-agentrunner-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
          await tracingProvider.createObservation({
            id: generationId,
            name: `AgentRunner LLM Generation`,
            type: 'generation',
            startTime: generationStartTime,
            parentObservationId: tracingContext.currentAgentSpanId || tracingContext.parentObservationId,
            model: modelName,
            modelParameters: {
              temperature: temperature ?? 0,
              provider: config.provider
            },
            input: {
              systemPrompt: currentSystemPrompt.substring(0, 500) + '...', // Truncate for tracing
              messages: messages.length,
              tools: tools.map(t => t.name),
              iteration: iteration + 1
            },
            metadata: {
              executionLevel: 'agentrunner',
              source: 'AgentRunner',
              agentName,
              iteration: iteration + 1,
              maxIterations,
              phase: 'llm_generation',
              ...(agentDescriptor ? {
                agentVersion: agentDescriptor.version,
                promptHash: agentDescriptor.promptHash,
                toolsetHash: agentDescriptor.toolsetHash
              } : {})
            }
          }, tracingContext.traceId);

          logger.debug(`[HIERARCHICAL_TRACING] AgentRunner: Created LLM generation:`, {
            generationId,
            agentName,
            iteration: iteration + 1,
            parentObservationId: tracingContext.currentAgentSpanId || tracingContext.parentObservationId,
            modelName
          });
          logger.info(`${agentName} Created AgentRunner LLM generation trace: ${generationId}`);
        }

        const llm = LLMClient.getInstance();
        const provider = config.provider as LLMProvider;

        // Prune old accessibility tree results to prevent context overflow
        const prunedMessages = AgentRunner.pruneAccessibilityTreeHistory(messages);
        const llmMessages = AgentRunner.convertToLLMMessages(prunedMessages);

        // Sanitize messages for model capabilities (strip images for non-vision models)
        let isVisionForMainCall = false;
        if (typeof config.getVisionCapability === 'function') {
          try {
            const res = await config.getVisionCapability(modelName);
            isVisionForMainCall = typeof res === 'boolean' ? res : false;
          } catch {
            isVisionForMainCall = false;
          }
        }
        const sanitizedForMainCall = sanitizeMessagesForModel(llmMessages, {
          visionCapable: isVisionForMainCall,
          placeholderForImageOnly: true,
        });

        llmResponse = await llm.call({
          provider,
          model: modelName,
          messages: sanitizedForMainCall,
          systemPrompt: currentSystemPrompt,
          tools: toolSchemas,
          temperature: temperature ?? 0,
          agentName: agentName,  // Pass agent identity for provider-specific routing
          // Pass tracing metadata explicitly for Langfuse integration
          tracingMetadata: tracingContext?.metadata,
        });

        // Extract token usage from rawResponse if available
        const rawUsage = llmResponse.rawResponse?.usage;

        // Accumulate LLM metrics in session
        if (agentSession.metrics) {
          agentSession.metrics.llmCallCount++;
          if (rawUsage) {
            agentSession.metrics.promptTokens += rawUsage.prompt_tokens || rawUsage.input_tokens || 0;
            agentSession.metrics.completionTokens += rawUsage.completion_tokens || rawUsage.output_tokens || 0;
            agentSession.metrics.totalTokens = agentSession.metrics.promptTokens + agentSession.metrics.completionTokens;
          }
        }

        // Complete the generation observation
        if (generationId && tracingContext?.traceId) {
          const usage = rawUsage ? {
            promptTokens: rawUsage.prompt_tokens || rawUsage.input_tokens || 0,
            completionTokens: rawUsage.completion_tokens || rawUsage.output_tokens || 0,
            totalTokens: rawUsage.total_tokens || 0
          } : undefined;

          await tracingProvider.updateObservation(generationId, {
            endTime: getRuntime().now(),
            output: {
              type: 'llm_response',
              hasToolCalls: llmResponse.reasoning?.summary ? true : false,
              responseLength: JSON.stringify(llmResponse).length
            },
            ...(usage && { usage }),
            metadata: {
              executionLevel: 'agentrunner',
              source: 'AgentRunner',
              agentName,
              iteration: iteration + 1,
              phase: 'completed',
              duration: Date.now() - generationStartTime.getTime(),
              ...(agentDescriptor ? {
                agentVersion: agentDescriptor.version,
                promptHash: agentDescriptor.promptHash,
                toolsetHash: agentDescriptor.toolsetHash
              } : {})
            }
          });

          logger.debug(`[HIERARCHICAL_TRACING] AgentRunner: Completed LLM generation:`, {
            generationId,
            agentName,
            iteration: iteration + 1,
            duration: Date.now() - generationStartTime.getTime()
          });
        }
      } catch (error: any) {
        logger.error(`${agentName} LLM call failed:`, error);
        const errorMsg = `LLM call failed: ${error.message || String(error)}`;

        // Complete generation observation with error
        const tracingContext = getCurrentTracingContext();
        const tracingProvider = createTracingProvider();
        if (generationId && tracingContext?.traceId) {
          await tracingProvider.updateObservation(generationId, {
            endTime: getRuntime().now(),
            error: error.message || String(error),
            metadata: {
              executionLevel: 'agentrunner',
              source: 'AgentRunner',
              agentName,
              iteration: iteration + 1,
              phase: 'error',
              ...(agentDescriptor ? {
                agentVersion: agentDescriptor.version,
                promptHash: agentDescriptor.promptHash,
                toolsetHash: agentDescriptor.toolsetHash
              } : {})
            }
          });
        }

        // Add system error message to history
        const systemErrorMessage: ToolResultMessage = {
            entity: ChatMessageEntity.TOOL_RESULT,
            toolName: 'system_error',
            resultText: errorMsg,
            isError: true,
            error: errorMsg,
        };
        messages.push(systemErrorMessage);

        // Generate summary of error scenario
        const errorSummary = await this.summarizeAgentProgress(messages, maxIterations, agentName, modelName, 'error', config.provider, config.getVisionCapability);

        // Complete session with error
        agentSession.status = 'error';
        agentSession.endTime = getRuntime().now();
        agentSession.terminationReason = 'error';

        // Emit session completed event (skip for background agents)
        AgentRunner.eventBus?.emitProgress({
          type: 'session_completed',
          sessionId: agentSession.sessionId,
          parentSessionId: agentSession.parentSessionId,
          agentName,
          timestamp: getRuntime().now(),
          data: { session: agentSession, reason: 'error' }
        }, isBackground);

        // Clear todo list on error
        await AgentRunner.clearTodoList(agentName, tools);

        // Use error hook with structured summary
        const result = createErrorResult(errorMsg, messages, 'error');
        result.summary = {
          type: 'error',
          content: errorSummary
        };

        // Execute afterExecute hook if defined
        if (afterExecute) {
          try {
            await afterExecute(result, agentSession);
          } catch (error) {
            logger.warn(`afterExecute hook failed for ${agentName}:`, error);
          }
        }

        return { ...result, agentSession };
      }

      // Parse LLM response
      const llm = LLMClient.getInstance();
      const parsedAction = llm.parseResponse(llmResponse);

      // Process parsed action
      try {
        let newModelMessage: ModelChatMessage;
        let toolCallObservationId: string | undefined; // Declare in action scope for tool execution access

        if (parsedAction.type === 'tool_call') {
          const { name: toolName, args: toolArgs } = parsedAction;
          const toolCallId = getRuntime().generateId(); // Generate unique ID for OpenAI format

          // Create tool call decision event for AgentRunner
          const tracingContext = getCurrentTracingContext();
          const tracingProvider = createTracingProvider();

          if (tracingContext?.traceId) {
            toolCallObservationId = `tool-call-agentrunner-${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
            await tracingProvider.createObservation({
              id: toolCallObservationId,
              name: `AgentRunner Tool Call Decision: ${toolName}`,
              type: 'event',
              startTime: getRuntime().now(),
              parentObservationId: generationId || tracingContext.currentAgentSpanId || tracingContext.parentObservationId,
              input: {
                toolName,
                toolArgs,
                toolCallId,
                reasoning: llmResponse.reasoning?.summary
              },
              metadata: {
                executionLevel: 'agentrunner',
                source: 'AgentRunner',
                agentName,
                iteration: iteration + 1,
                toolCallId,
                phase: 'tool_call_decision'
              }
            }, tracingContext.traceId);

            logger.debug(`[HIERARCHICAL_TRACING] AgentRunner: Created tool call decision:`, {
              toolCallObservationId,
              toolName,
              agentName,
              iteration: iteration + 1,
              parentObservationId: generationId || tracingContext.currentAgentSpanId || tracingContext.parentObservationId
            });

            logger.info(`${agentName} Created AgentRunner tool call decision: ${toolCallObservationId} for ${toolName}`);
          }

          newModelMessage = {
            entity: ChatMessageEntity.MODEL,
            action: 'tool',
            toolName,
            toolArgs,
            toolCallId, // Add for linking with tool response
            isFinalAnswer: false,
            reasoning: llmResponse.reasoning?.summary,
          };
          messages.push(newModelMessage);

          // Add tool call to current session
          addSessionMessage({
            type: 'tool_call',
            content: {
              type: 'tool_call',
              toolName,
              toolArgs,
              toolCallId,
              reasoning: Array.isArray(llmResponse.reasoning?.summary)
                ? llmResponse.reasoning.summary.join(' ')
                : (llmResponse.reasoning?.summary || undefined)
            }
          });

          // Accumulate tool call metrics
          if (agentSession.metrics) {
            agentSession.metrics.toolCallCount++;
            agentSession.metrics.toolCallsByName[toolName] = (agentSession.metrics.toolCallsByName[toolName] || 0) + 1;
          }

          logger.info(`${agentName} LLM requested tool: ${toolName}`);

          // Execute tool
          const toolToExecute = toolMap.get(toolName);
          if (!toolToExecute) {
            const result = errorHandler.handleUnknownTool(toolName, toolCallId);
            if (result.shouldContinue && result.errorMessage) {
              messages.push(result.errorMessage);
              if (result.sessionMessage) {
                addSessionMessage(result.sessionMessage);
              }
              continue; // Continue to next iteration
            }
            // If not continuing, this would throw an error (but our config sets continueOnError: true)
            continue; // Ensure we don't proceed with undefined tool
          }

          let toolResultText: string = '';
          let toolIsError = false;
          let toolResultData: any = null;
          let imageData: string | undefined;

          // *** Check if it's an LLM-triggered handoff tool call ***
          if (toolName.startsWith('handoff_to_') && toolToExecute instanceof ConfigurableAgentTool) {
              const targetAgentTool = toolToExecute; // Already resolved via toolMap
              // Find the corresponding handoff config (must be llm_tool_call trigger)
              const handoffConfig = executingAgent?.config.handoffs?.find(h =>
                  h.targetAgentName === targetAgentTool.name &&
                  (!h.trigger || h.trigger === 'llm_tool_call')
              );

              if (!handoffConfig) {
                  throw new Error(`Internal error: No matching 'llm_tool_call' handoff config found for ${toolName}`);
              }

              // Add handoff message to current session
              const nestedSessionId = getRuntime().generateId();
              addSessionMessage({
                type: 'handoff',
                content: {
                  type: 'handoff',
                  targetAgent: targetAgentTool.name,
                  reason: `Handing off to ${targetAgentTool.name}`,
                  context: toolArgs as Record<string, any>,
                  nestedSessionId
                }
              });

              // Capture screenshot before handoff execution (if callback provided)
              if (config.onBeforeToolExecution) {
                try {
                  await config.onBeforeToolExecution(toolName, toolArgs);
                } catch (hookError) {
                  logger.warn(`onBeforeToolExecution hook failed: ${hookError}`);
                }
              }

              // Use the shared handoff execution logic, passing LLM's toolArgs and current session
              const handoffResult = await AgentRunner.executeHandoff(
                  messages, // Pass current message history
                  toolArgs as ConfigurableAgentArgs, // <= LLM's toolArgs are the 'originalArgs' for this handoff context
                  handoffConfig,
                  executingAgent!, // executingAgent must exist if handoff config was found
                  apiKey, modelName, maxIterations, temperature ?? 0,
                  createSuccessResult, createErrorResult,
                  toolArgs as ConfigurableAgentArgs, // <= Pass LLM's toolArgs explicitly as llmToolArgs
                  currentSession, // Pass current session for natural nesting
                  config.provider,
                  config.getVisionCapability,
                  config.miniModel,
                  config.nanoModel,
                  { sessionId: nestedSessionId, parentSessionId: currentSession.sessionId, traceId: getCurrentTracingContext()?.traceId },
                  config.onBeforeToolExecution
              );

              // LLM tool handoff replaces the current agent's execution entirely
              // Complete current session and return result with session
              agentSession.status = 'completed';
              agentSession.endTime = getRuntime().now();
              agentSession.terminationReason = 'handed_off';

              // Emit session completed event (skip for background agents)
              AgentRunner.eventBus?.emitProgress({
                type: 'session_completed',
                sessionId: agentSession.sessionId,
                parentSessionId: agentSession.parentSessionId,
                agentName,
                timestamp: getRuntime().now(),
                data: { session: agentSession, reason: 'handed_off' }
              }, isBackground);

              return { ...handoffResult, agentSession };

          } else if (toolToExecute) {
            // *** Regular tool execution ***

            // Create tool execution span
            const tracingContext = getCurrentTracingContext();
            const tracingProvider = createTracingProvider();
            let toolSpanId: string | undefined;
            const toolStartTime = getRuntime().now();

            if (tracingContext?.traceId) {
              toolSpanId = `tool-exec-agentrunner-${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
              try {
                await tracingProvider.createObservation({
                  id: toolSpanId,
                  name: `AgentRunner Tool Execution: ${toolName}`,
                  type: 'span',
                  startTime: toolStartTime,
                  parentObservationId: toolCallObservationId || tracingContext.currentToolCallId || tracingContext.parentObservationId,
                  input: toolArgs,
                  metadata: {
                    executionLevel: 'agentrunner',
                    source: 'AgentRunner',
                    agentName,
                    toolName,
                    toolCallId,
                    iteration: iteration + 1,
                    phase: 'tool_execution',
                    parentToolCallDecision: toolCallObservationId
                  }
                }, tracingContext.traceId);
                logger.debug(`[HIERARCHICAL_TRACING] AgentRunner: Created tool execution span:`, {
                  toolSpanId,
                  toolName,
                  agentName,
                  iteration: iteration + 1,
                  parentObservationId: toolCallObservationId || tracingContext.currentToolCallId || tracingContext.parentObservationId
                });
                logger.info(`${agentName} Created AgentRunner tool execution span: ${toolSpanId} for ${toolName}`);
              } catch (tracingError) {
                logger.warn(`${agentName} Failed to create AgentRunner tool execution span:`, tracingError);
              }
            }

             // Special handling for agent-to-agent tool calls
             let preallocatedChildId: string | undefined;
             if (toolToExecute instanceof ConfigurableAgentTool) {
               // This is an agent being called as a tool!
               
               // Pre-allocate child session ID and add placeholder for real-time UI
               preallocatedChildId = getRuntime().generateId();
               const childPlaceholder: AgentSession = {
                 sessionId: preallocatedChildId,
                 agentName: toolName,
                 parentSessionId: currentSession.sessionId,
                 status: 'running',
                 startTime: getRuntime().now(),
                 messages: [],
                 nestedSessions: [],
                 tools: []
               };
               currentSession.nestedSessions.push(childPlaceholder);
               // Add a handoff anchor message to the parent session timeline so the UI can inline the child timeline
               addSessionMessage({
                 type: 'handoff',
                 content: {
                   type: 'handoff',
                   targetAgent: toolName,
                   reason: `Handing off to ${toolName}`,
                   context: toolArgs as Record<string, any>,
                   nestedSessionId: preallocatedChildId
                 }
               });
               
               // Emit child agent starting (skip for background agents)
               AgentRunner.eventBus?.emitProgress({
                 type: 'child_agent_started',
                 sessionId: currentSession.sessionId,
                 parentSessionId: currentSession.parentSessionId,
                 agentName: currentSession.agentName,
                 timestamp: getRuntime().now(),
                 data: {
                   parentSession: currentSession,
                   childAgentName: toolName,
                   childSessionId: preallocatedChildId
                 }
               }, isBackground);
            }

            try {
              // Call pre-execution hook if provided (for screenshots, logging, etc.)
              if (config.onBeforeToolExecution) {
                try {
                  await config.onBeforeToolExecution(toolToExecute.name, toolArgs);
                } catch (hookError) {
                  logger.warn(`onBeforeToolExecution hook failed: ${hookError}`);
                  // Continue with execution even if hook fails
                }
              }

              logger.info(`${agentName} Executing tool: ${toolToExecute.name}`);
              const execTracingContext = getCurrentTracingContext();
              toolResultData = await toolToExecute.execute(toolArgs as any, ({
                apiKey: config.apiKey,
                provider: config.provider,
                model: modelName,
                miniModel: config.miniModel,
                nanoModel: config.nanoModel,
                getVisionCapability: config.getVisionCapability,
                abortSignal: abortSignal,
                overrideSessionId: preallocatedChildId,
                overrideParentSessionId: currentSession.sessionId,
                overrideTraceId: execTracingContext?.traceId,
                cdpAdapter: config.cdpAdapter,
              } as any));
              
              // If this was an agent tool, replace placeholder with actual session
              if (toolToExecute instanceof ConfigurableAgentTool && toolResultData?.agentSession) {
                const index = currentSession.nestedSessions.findIndex(
                  s => s.sessionId === preallocatedChildId
                );
                if (index !== -1) {
                  // Ensure the child session knows its parent for downstream UI logic
                  try { (toolResultData.agentSession as any).parentSessionId = currentSession.sessionId; } catch {}
                  currentSession.nestedSessions[index] = toolResultData.agentSession;
                }
              }

              // Extract image data if present (before sanitization)
              if (typeof toolResultData === 'object' && toolResultData !== null) {
                imageData = toolResultData.imageData;
              }

              // Create sanitized data for text representation (exclude imageData to avoid token waste)
              const sanitizedData = this.sanitizeToolResultForText(toolResultData);

              // Special handling for ConfigurableAgentResult
              if (typeof toolResultData === 'object' && toolResultData !== null &&
                  'success' in toolResultData && ('output' in toolResultData || 'error' in toolResultData)) {
                // This is a ConfigurableAgentResult from another agent
                toolResultText = toolResultData.success
                  ? (toolResultData.output || 'Agent completed successfully')
                  : (toolResultData.error || 'Agent failed');
              } else {
                // Regular tool result
                toolResultText = AgentRunner.computeToolResultText(toolResultData, imageData);
              }

              // Check if the result object indicates an error explicitly
              if (typeof toolResultData === 'object' && toolResultData !== null) {
                 if (toolResultData.hasOwnProperty('error') && !!toolResultData.error) {
                    toolIsError = true;
                    // Use the error message from the result object if available
                    toolResultText = toolResultData.error || toolResultText;
                 } else if (toolResultData.hasOwnProperty('success') && toolResultData.success === false) {
                    toolIsError = true;
                     // Try to find an error message field, fallback to stringified object
                    toolResultText = toolResultData.error || toolResultData.message || toolResultText;
                 }
              }

              // Complete tool execution span with success
              if (toolSpanId && tracingContext?.traceId) {
                try {
                  await tracingProvider.updateObservation(toolSpanId, {
                    endTime: getRuntime().now(),
                    output: toolResultData,
                    metadata: {
                      executionLevel: 'agentrunner',
                      source: 'AgentRunner',
                      agentName,
                      toolName,
                      toolCallId,
                      iteration: iteration + 1,
                      phase: 'completed',
                      duration: Date.now() - toolStartTime.getTime(),
                      success: !toolIsError,
                      parentToolCallDecision: toolCallObservationId
                    }
                  });
                  logger.debug(`[HIERARCHICAL_TRACING] AgentRunner: Completed tool execution span:`, {
                    toolSpanId,
                    toolName,
                    agentName,
                    success: !toolIsError,
                    duration: Date.now() - toolStartTime.getTime()
                  });
                  logger.info(`${agentName} Completed AgentRunner tool execution span: ${toolSpanId}`);
                } catch (tracingError) {
                  logger.warn(`${agentName} Failed to complete AgentRunner tool execution span:`, tracingError);
                }
              }

             } catch (err: any) {
              logger.error(`${agentName} Error executing tool ${toolToExecute.name}:`, err);
              toolResultText = `Error during tool execution: ${err.message || String(err)}`;
              toolIsError = true;
              toolResultData = { error: toolResultText }; // Store error in data

              // Complete tool execution span with error
              if (toolSpanId && tracingContext?.traceId) {
                try {
                  await tracingProvider.updateObservation(toolSpanId, {
                    endTime: getRuntime().now(),
                    error: err.message || String(err),
                    metadata: {
                      executionLevel: 'agentrunner',
                      source: 'AgentRunner',
                      agentName,
                      toolName,
                      toolCallId,
                      iteration: iteration + 1,
                      phase: 'error',
                      duration: Date.now() - toolStartTime.getTime(),
                      success: false,
                      parentToolCallDecision: toolCallObservationId
                    }
                  });
                  logger.info(`${agentName} Completed AgentRunner tool execution span with error: ${toolSpanId}`);
                } catch (tracingError) {
                  logger.warn(`${agentName} Failed to complete AgentRunner tool execution span with error:`, tracingError);
                }
              }
             }
          }

          // Add tool result message
          const toolResultMessage: ToolResultMessage = {
            entity: ChatMessageEntity.TOOL_RESULT,
            toolName,
            resultText: toolResultText,
            isError: toolIsError,
            toolCallId, // Link back to the tool call for OpenAI format
            ...(toolIsError && { error: toolResultText }), // Include raw error message if error occurred
            ...(toolResultData && { resultData: toolResultData }), // Include structured result data
            ...(imageData && { imageData: imageData }) // Include image data for multimodal LLM responses
          };

          // Extract structured summary if this is from a ConfigurableAgentResult
          if (typeof toolResultData === 'object' && toolResultData !== null &&
              'success' in toolResultData && toolResultData.summary) {
            // Use the structured summary directly
            toolResultMessage.summary = toolResultData.summary.content;
          }

          messages.push(toolResultMessage);

          // Add tool result to current session
          addSessionMessage({
            type: 'tool_result',
            content: {
              type: 'tool_result',
              toolCallId,
              toolName,
              success: !toolIsError,
              result: toolResultData,
              error: toolIsError ? toolResultText : undefined
            }
          });
          logger.info(`${agentName} Tool ${toolName} execution result added. Error: ${toolIsError}`);

        } else if (parsedAction.type === 'final_answer') {
          const { answer } = parsedAction;
          newModelMessage = {
            entity: ChatMessageEntity.MODEL,
            action: 'final',
            answer,
            isFinalAnswer: true,
            reasoning: llmResponse.reasoning?.summary,
          };
          messages.push(newModelMessage);

          // Add final answer to current session
          addSessionMessage({
            type: 'final_answer',
            content: {
              type: 'final_answer',
              answer,
              summary: Array.isArray(llmResponse.reasoning?.summary)
                ? llmResponse.reasoning.summary.join(' ')
                : (llmResponse.reasoning?.summary || undefined)
            }
          });

          logger.info(`${agentName} LLM provided final answer.`);

          // Clear non-empty todo list when sending final message
          await AgentRunner.clearTodoList(agentName, tools);

          // Conditionally generate and append summary based on agent configuration
          let finalAnswer = answer;
          if (executingAgent?.config?.includeSummaryInAnswer === true) {
            logger.info(`Generating summary for ${agentName} (includeSummaryInAnswer=true)`);
            const completionSummary = await this.summarizeAgentProgress(messages, maxIterations, agentName, modelName, 'final_answer', config.provider, config.getVisionCapability);
            // Append summary to the answer with clear separator
            finalAnswer = `${answer}\n\n---\n\n### Analysis of Agentic Conversation\n\n${completionSummary}`;
          } else {
            logger.info(`Skipping summary for ${agentName} (includeSummaryInAnswer not enabled)`);
          }

          // Complete session naturally
          agentSession.status = 'completed';
          agentSession.endTime = getRuntime().now();
          agentSession.terminationReason = 'final_answer';

          // Emit session completed event (skip for background agents)
          AgentRunner.eventBus?.emitProgress({
            type: 'session_completed',
            sessionId: agentSession.sessionId,
            parentSessionId: agentSession.parentSessionId,
            agentName,
            timestamp: getRuntime().now(),
            data: { session: agentSession, reason: 'final_answer' }
          }, isBackground);

          // Exit loop and return success with final answer (summary appended if configured)
          const result = createSuccessResult(finalAnswer, messages, 'final_answer');

          // Execute afterExecute hook if defined
          if (afterExecute) {
            try {
              await afterExecute(result, agentSession);
            } catch (error) {
              logger.warn(`afterExecute hook failed for ${agentName}:`, error);
              // Continue and return result even if afterExecute fails
            }
          }

          return { ...result, agentSession };

        } else if (parsedAction.type === 'error') {
          const result = errorHandler.handleParsingError(parsedAction.error);
          if (result.shouldContinue && result.errorMessage) {
            messages.push(result.errorMessage);
            if (result.sessionMessage) {
              addSessionMessage(result.sessionMessage);
            }
            continue; // Continue to next iteration so the LLM can try again
          }
        } else {
          // Unknown parsed action type
          throw new Error(`Unknown parsed action type: ${(parsedAction as any).type}`);
        }

      } catch (error: any) {
        logger.error(`${agentName} Error processing LLM response or executing tool:`, error);
        const errorMsg = `Agent loop error: ${error.message || String(error)}`;
         // Add system error message to history
        const systemErrorMessage: ToolResultMessage = {
            entity: ChatMessageEntity.TOOL_RESULT,
            toolName: 'system_error',
            resultText: errorMsg,
            isError: true,
            error: errorMsg,
        };
        messages.push(systemErrorMessage);

        // Generate summary of error scenario
        const errorSummary = await this.summarizeAgentProgress(messages, maxIterations, agentName, modelName, 'error', config.provider, config.getVisionCapability);

        // Complete session with error
        agentSession.status = 'error';
        agentSession.endTime = getRuntime().now();
        agentSession.terminationReason = 'error';

        // Emit session completed event (skip for background agents)
        AgentRunner.eventBus?.emitProgress({
          type: 'session_completed',
          sessionId: agentSession.sessionId,
          parentSessionId: agentSession.parentSessionId,
          agentName,
          timestamp: getRuntime().now(),
          data: { session: agentSession, reason: 'error' }
        }, isBackground);

        // Clear todo list on error
        await AgentRunner.clearTodoList(agentName, tools);

        // Use error hook with structured summary
        const result = createErrorResult(errorMsg, messages, 'error');
        result.summary = {
          type: 'error',
          content: errorSummary
        };

        // Execute afterExecute hook if defined
        if (afterExecute) {
          try {
            await afterExecute(result, agentSession);
          } catch (error) {
            logger.warn(`afterExecute hook failed for ${agentName}:`, error);
          }
        }

        return { ...result, agentSession };
      }
    }

    // Max iterations reached - Check for 'max_iterations' handoff trigger
    logger.warn(`${agentName} Reached max iterations (${maxIterations}) without completion.`);

    if (executingAgent?.config.handoffs) {
        const maxIterHandoffConfig = executingAgent.config.handoffs.find(h => h.trigger === 'max_iterations');

        if (maxIterHandoffConfig) {
            logger.info(`${agentName} Found 'max_iterations' handoff config. Initiating handoff to ${maxIterHandoffConfig.targetAgentName}.`);

            // Use the shared handoff execution logic
            // Pass the original `args` received by *this* agent runner instance. No llmToolArgs here.
            const handoffResult = await AgentRunner.executeHandoff(
                messages, // Pass the final message history from the loop
                args,     // Pass the original args of the *current* agent as 'originalArgs'
                maxIterHandoffConfig,
                executingAgent,
                apiKey, modelName, maxIterations, temperature ?? 0,
                createSuccessResult, createErrorResult,
                undefined, // No llmToolArgs for max iterations handoff
                currentSession, // Pass current session for natural nesting
                config.provider,
                config.getVisionCapability,
                config.miniModel,
                config.nanoModel,
                undefined, // No overrides for max iterations handoff
                config.onBeforeToolExecution
            );
            // Extract the result and session
            const { agentSession: childSession, ...actualResult } = handoffResult;

            // Add child session to current session's nested sessions (natural nesting)
            if (currentSession) {
              currentSession.nestedSessions.push(childSession);
            }

            // Complete current session and return result with session
            agentSession.status = 'completed';
            agentSession.endTime = getRuntime().now();
            agentSession.terminationReason = 'handed_off';

            // Emit session completed event (skip for background agents)
            AgentRunner.eventBus?.emitProgress({
              type: 'session_completed',
              sessionId: agentSession.sessionId,
              parentSessionId: agentSession.parentSessionId,
              agentName,
              timestamp: getRuntime().now(),
              data: { session: agentSession, reason: 'handed_off' }
            }, isBackground);

            return { ...actualResult, agentSession }; // Return the result from the handoff target
        }
    }

    // If no max_iterations handoff is configured, return the standard error
    logger.warn(`${agentName} No 'max_iterations' handoff configured. Returning error.`);

    // Complete session with max iterations error
    agentSession.status = 'error';
    agentSession.endTime = getRuntime().now();
    agentSession.terminationReason = 'max_iterations';

    // Emit session completed event (skip for background agents)
    AgentRunner.eventBus?.emitProgress({
      type: 'session_completed',
      sessionId: agentSession.sessionId,
      parentSessionId: agentSession.parentSessionId,
      agentName,
      timestamp: getRuntime().now(),
      data: { session: agentSession, reason: 'max_iterations' }
    }, isBackground);

    // Generate summary of agent progress instead of generic error message
    const progressSummary = await this.summarizeAgentProgress(messages, maxIterations, agentName, modelName, 'max_iterations', config.provider, config.getVisionCapability);

    // Clear todo list on max iterations
    await AgentRunner.clearTodoList(agentName, tools);

    const result = createErrorResult('Agent reached maximum iterations', messages, 'max_iterations');
    result.summary = {
      type: 'timeout',
      content: progressSummary
    };

    // Execute afterExecute hook if defined
    if (afterExecute) {
      try {
        await afterExecute(result, agentSession);
      } catch (error) {
        logger.warn(`afterExecute hook failed for ${agentName}:`, error);
      }
    }

    return { ...result, agentSession };
  }

  /**
   * Uses LLM to generate a meaningful summary when agent completes execution.
   * Leverages KV-cache by sending all existing messages plus a summary request.
   */
  private static async summarizeAgentProgress(
    messages: ChatMessage[],
    maxIterations: number,
    agentName: string,
    modelName: string,
    completionType: 'final_answer' | 'max_iterations' | 'error' = 'max_iterations',
    provider: LLMProvider,
    getVisionCapability?: (modelName: string) => Promise<boolean> | boolean
  ): Promise<string> {
    logger.info(`Generating summary for agent "${agentName}" with completion type: ${completionType}`);
    try {
      // Use existing convertToLLMMessages method for consistency
      const llmMessages = this.convertToLLMMessages(messages);

      // Add system message at the beginning for better context
      llmMessages.unshift({
        role: 'system',
        content: `You are an expert AI agent analyzer specializing in understanding multi-agent workflows and execution patterns. Your task is to analyze agent conversations that have reached their iteration limits and generate actionable summaries.

Key guidelines:
- Focus on extracting the core user intent and what the agent was trying to accomplish
- Identify patterns of progress, loops, or stuck behaviors
- Highlight key decisions the agent made and tools it used
- Assess whether the agent was making meaningful progress toward the goal
- Provide specific, actionable insights that would help a calling agent decide next steps
- Be concise but comprehensive in your analysis
- Consider the context of web automation, data extraction, and multi-agent coordination`
      });

      // Generate completion-specific summary prompt
      let summaryPrompt: string;
      switch (completionType) {
        case 'final_answer':
          summaryPrompt = `Please analyze the entire conversation above and provide a concise summary that includes:

1. **User Request**: What the user originally asked for
2. **Agent Decisions**: Key decisions and actions the agent took to accomplish the task
3. **Final Outcome**: What the agent accomplished`;
          break;

        case 'error':
          summaryPrompt = `1. **User Request**: What the user originally asked for
2. **Agent Decisions**: Key decisions and actions the agent took before the error
3. **Error Context**: What the agent was attempting when the error occurred`;
          break;

        case 'max_iterations':
        default:
          summaryPrompt = `The agent "${agentName}" has reached its maximum iteration limit of ${maxIterations}.

Please analyze the entire conversation above and provide a COMPREHENSIVE and DETAILED summary (minimum 400-600 words) that includes:

1. **User Request** (1-2 paragraphs)
   - What the user originally asked for
   - Key requirements and scope mentioned
   - Expected deliverables or outcomes

2. **Agent Decisions** (2-3 paragraphs)
   - List each tool call made with specific details (tool name, key arguments, purpose)
   - Explain the reasoning behind each decision
   - Describe the strategy or approach the agent took
   - What data or information was extracted at each step
   - Any patterns in the agent's behavior (e.g., broad searches, specific targeting)

3. **Final State** (1-2 paragraphs)
   - Exactly what the agent was doing when it timed out
   - What task was in progress
   - What data had been gathered so far (URLs, content, structured data)
   - State of any ongoing operations

4. **Progress Assessment** (2-3 paragraphs)
   - Whether the agent was making meaningful progress toward the goal
   - If stuck, identify loops, errors, or blocking issues
   - Assess if the iteration limit (${maxIterations}) was appropriate for this task
   - What percentage of the goal was accomplished
   - Quality of work completed so far

5. **Recommendations for Next Steps** (2-3 paragraphs with bullet points)
   - Specific, actionable steps a calling agent should take to continue this work
   - Which tools to use next and with what arguments
   - What data to prioritize or process
   - Suggested iteration limit if re-running
   - Alternative approaches if current path seems blocked

IMPORTANT: Even if the agent only completed a few iterations, provide DETAILED analysis of what it did accomplish. Describe each action comprehensively, analyze the decision-making, and provide concrete recommendations. Do not give brief answers - expand each section thoroughly with specific examples and data from the conversation.`;
          break;
      }

      // Add final user message requesting summary
      llmMessages.push({
        role: 'user',
        content: summaryPrompt
      });

      const selectedProvider = provider;

      // Centralized, capability-aware sanitization: strip images for non-vision models
      let isVision = false;
      if (typeof getVisionCapability === 'function') {
        try {
          const res = await getVisionCapability(modelName);
          isVision = typeof res === 'boolean' ? res : false;
        } catch {
          isVision = false;
        }
      }
      const sanitizedMessages = sanitizeMessagesForModel(llmMessages, {
        visionCapable: isVision,
        placeholderForImageOnly: true,
      });

      const response = await callLLMWithTracing(
        {
          provider: selectedProvider as LLMProvider,
          model: modelName,
          messages: sanitizedMessages,
          systemPrompt: '', // Empty string instead of undefined
          temperature: 0.1,
          // Omit tools parameter entirely to avoid tool_choice conflicts
        },
        {
          toolName: 'AgentRunner',
          operationName: 'summarize_agent_progress',
          context: 'agent_analysis',
          additionalMetadata: {
            agentName,
            completionType,
            maxIterations,
            messageCount: messages.length
          }
        }
      );

      logger.info(`Generated summary for agent "${agentName}":`, response.text || 'No summary generated.');
      return response.text || 'No summary generated.';

    } catch (error) {
      logger.error('Failed to generate agent progress summary:', error);
      // Fallback to simple message if LLM summary fails
      return `Agent ${agentName} reached maximum iterations (${maxIterations}). Summary generation failed.`;
    }
  }
}
