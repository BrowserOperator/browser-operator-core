// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { Tool } from '../tools/Tools.js';
import { ChatMessageEntity, type ChatMessage } from '../models/ChatTypes.js';
import { createLogger } from '../core/Logger.js';
import { AgentDescriptorRegistry, type AgentDescriptor } from '../core/AgentDescriptorRegistry.js';
import { getCurrentTracingContext } from '../tracing/TracingConfig.js';
import { MODEL_SENTINELS } from '../core/Constants.js';
import type { AgentSession } from './AgentSessionTypes.js';
import type { LLMProvider } from '../LLM/LLMTypes.js';
import type { CDPSessionAdapter } from '../cdp/CDPSessionAdapter.js';
import { getRuntime } from './RuntimeContext.js';

const logger = createLogger('ConfigurableAgentTool');
const DEFAULT_AGENT_TOOL_VERSION = '2025-09-17';

import { AgentRunner, type AgentRunnerConfig, type AgentRunnerHooks } from './AgentRunner.js';

// Context passed along with agent/tool calls
export interface CallCtx {
  apiKey?: string,
  provider?: LLMProvider,
  model?: string,
  miniModel?: string,
  nanoModel?: string,
  mainModel?: string,
  getVisionCapability?: (modelName: string) => Promise<boolean> | boolean,
  overrideSessionId?: string,
  overrideParentSessionId?: string,
  overrideTraceId?: string,
  abortSignal?: AbortSignal,
  agentDescriptor?: AgentDescriptor,
  /** If true, don't emit UI progress events (for background agents) */
  background?: boolean,
  /**
   * CDP session adapter for browser interactions.
   * When provided, tools use this adapter instead of the global SDK.Target.
   * This enables running agents from contexts outside DevTools (e.g., eval runner).
   */
  cdpAdapter?: CDPSessionAdapter,
  /**
   * Called before each tool execution (for logging/debugging).
   * Useful for capturing screenshots or state before actions.
   */
  onBeforeToolExecution?: (toolName: string, toolArgs: unknown) => Promise<void>,
}

/**
 * Defines the possible reasons an agent run might terminate.
 */
export type AgentRunTerminationReason = 'final_answer' | 'max_iterations' | 'error' | 'custom_exit' | 'handed_off';

/**
 * Defines the possible triggers for a handoff.
 */
export type HandoffTrigger = 'llm_tool_call' | 'max_iterations';

/**
 * Configuration for a specific handoff target.
 */
export interface HandoffConfig {
  /**
   * The registered name of the agent to hand off to.
   */
  targetAgentName: string;

  /**
   * The condition that triggers this handoff. Defaults to 'llm_tool_call'.
   */
  trigger?: HandoffTrigger;

  /**
   * Optional array of tool names. If specified, only the results from these tools
   * in the sending agent's history will be collected and potentially passed to the
   * target agent as handoff messages.
   */
  includeToolResults?: string[];

  // TODO: Add toolNameOverride, toolDescriptionOverride, transitionalMessage later
}

/**
 * UI display configuration for an agent
 */
export interface AgentUIConfig {
  /**
   * Display name for the agent (human-readable)
   */
  displayName?: string;

  /**
   * Avatar/icon for the agent (emoji or icon class)
   */
  avatar?: string;

  /**
   * Primary color for the agent (hex code)
   */
  color?: string;

  /**
   * Background color for the agent (hex code)
   */
  backgroundColor?: string;
}

/**
 * JSON configuration for an agent tool
 */
export interface AgentToolConfig {
  /**
   * Name of the agent tool
   */
  name: string;

  /**
   * Description of the agent tool
   */
  description: string;

  /**
   * System prompt for the agent
   */
  systemPrompt: string;

  /**
   * Tool names to make available to the agent
   */
  tools: string[];

  /**
   * Semantic version identifier for this agent configuration
   */
  version?: string;

  /**
   * Defines potential handoffs to other agents.
   * Handoffs triggered by 'llm_tool_call' are presented as tools to the LLM.
   * Handoffs triggered by 'max_iterations' are executed automatically if the agent hits the limit.
   */
  handoffs?: HandoffConfig[];

  /**
   * Maximum iterations for the agent loop
   */
  maxIterations?: number;

  /**
   * Model name to use for the agent. Can be a string or a function that returns a string.
   */
  modelName?: string | (() => string);

  /**
   * Temperature for the agent
   */
  temperature?: number;

  /**
   * Schema for the agent tool arguments
   */
  schema: {
    type: string,
    properties: Record<string, unknown>,
    required?: string[],
  };

  /**
   * UI display configuration for the agent
   */
  ui?: AgentUIConfig;

  /**
   * Custom initialization function name
   */
  init?: (agent: ConfigurableAgentTool) => void;

  /**
   * Custom message preparation function name
   */
  prepareMessages?: (args: ConfigurableAgentArgs, config: AgentToolConfig) => ChatMessage[];

  /**
   * Custom success result creation function name
   */
  createSuccessResult?: (output: string, intermediateSteps: ChatMessage[], reason: AgentRunTerminationReason, config: AgentToolConfig) => ConfigurableAgentResult;

  /**
   * Custom error result creation function name
   */
  createErrorResult?: (error: string, intermediateSteps: ChatMessage[], reason: AgentRunTerminationReason, config: AgentToolConfig) => ConfigurableAgentResult;

  /**
   * If true, the agent WILL include intermediateSteps in its final returned result
   * (both success and error results). Defaults to false (steps are omitted).
   */
  includeIntermediateStepsOnReturn?: boolean;

  /**
   * If true, generate a summary of the agent's execution and append it to the final answer.
   * Summary includes: user request, agent decisions, and final outcome.
   * Defaults to false (no summary generated).
   * Use this for agents where understanding the execution process is valuable (e.g., web automation agents).
   */
  includeSummaryInAnswer?: boolean;

  /**
   * Optional lifecycle hook that runs before the agent starts executing.
   * Use this for agent-specific pre-execution logic such as environment setup,
   * page navigation, or prerequisite checks.
   *
   * @param callCtx - The call context containing API keys, models, and other execution context
   * @returns Promise that resolves when pre-execution is complete
   */
  beforeExecute?: (callCtx: CallCtx) => Promise<void>;

  /**
   * Optional lifecycle hook that runs after the agent completes execution.
   * Use this for agent-specific post-execution logic such as saving results,
   * cleanup operations, or data aggregation.
   *
   * @param result - The final agent execution result (success or error)
   * @param agentSession - The complete agent session with all messages and tool calls
   * @param callCtx - The call context containing API keys, models, and other execution context
   * @returns Promise that resolves when post-execution is complete
   */
  afterExecute?: (result: ConfigurableAgentResult, agentSession: AgentSession, callCtx: CallCtx) => Promise<void>;
}

/**
 * Registry of tool factory functions
 */
export class ToolRegistry {
  private static toolFactories = new Map<string, () => Tool<any, any>>();
  private static registeredTools = new Map<string, Tool<any, any>>(); // Store instances

  /**
   * Register a tool factory and create/store an instance
   */
  static registerToolFactory(name: string, factory: () => Tool<any, any>): void {
    if (this.toolFactories.has(name)) {
        logger.warn(`Tool factory already registered for: ${name}. Overwriting.`);
    }
    if (this.registeredTools.has(name)) {
        logger.warn(`Tool instance already registered for: ${name}. Overwriting.`);
    }
    this.toolFactories.set(name, factory);
    // Create and store the instance immediately upon registration
    try {
        const instance = factory();
        this.registeredTools.set(name, instance);
        logger.info(`Registered and instantiated tool: ${name}`);
    } catch (error) {
        logger.error(`Failed to instantiate tool '${name}' during registration:`, error);
        // Remove the factory entry if instantiation fails
        this.toolFactories.delete(name);
    }
  }

  /**
   * Get a tool instance by name
   */
  static getToolInstance(name: string): Tool<any, any> | null {
    const factory = this.toolFactories.get(name);
    return factory ? factory() : null;
  }

  /**
   * Get a pre-registered tool instance by name
   */
  static getRegisteredTool(name: string): Tool<any, any> | null {
    const instance = this.registeredTools.get(name);
    if (!instance) {
        // Don't fallback, require pre-registration for handoffs
        // logger.warn(`No registered instance found for tool: ${name}.`);
        return null;
    }
    return instance;
  }

  /**
   * Get all registered tool names
   */
  static getRegisteredToolNames(): string[] {
    return Array.from(this.registeredTools.keys());
  }
}

/**
 * Arguments for the ConfigurableAgentTool
 */
export interface ConfigurableAgentArgs extends Record<string, unknown> {
  /**
   * Original query or input
   */
  query: string;

  /**
   * Reasoning for invocation
   */
  reasoning: string;

  /**
   * Additional arguments based on schema
   */
  [key: string]: unknown;
}

/**
 * Result from the ConfigurableAgentTool
 */
export interface ConfigurableAgentResult {
  /**
   * Whether the execution was successful
   */
  success: boolean;

  /**
   * Final output if successful
   */
  output?: string;

  /**
   * Error message if unsuccessful
   */
  error?: string;

  /**
   * Intermediate steps for debugging
   */
  intermediateSteps?: ChatMessage[];

  /**
   * Termination reason for the agent run
   */
  terminationReason: AgentRunTerminationReason;

  /**
   * Structured summary of agent execution
   */
  summary?: {
    /**
     * Type of completion
     */
    type: 'completion' | 'error' | 'timeout';
    
    /**
     * Formatted summary text
     */
    content: string;
  };
}

/**
 * An agent tool that can be configured via JSON
 */
export class ConfigurableAgentTool implements Tool<ConfigurableAgentArgs, ConfigurableAgentResult> {
  name: string;
  description: string;
  config: AgentToolConfig;
  schema: {
    type: string,
    properties: Record<string, unknown>,
    required?: string[],
  };

  constructor(config: AgentToolConfig) {
    this.name = config.name;
    this.description = config.description;
    this.config = config;
    this.schema = config.schema;

    // Validate that required fields are present
    if (!config.systemPrompt) {
      throw new Error(`ConfigurableAgentTool: systemPrompt is required for ${config.name}`);
    }

    AgentDescriptorRegistry.registerSource({
      name: config.name,
      type: 'configurable_agent',
      version: config.version ?? DEFAULT_AGENT_TOOL_VERSION,
      promptProvider: () => config.systemPrompt,
      toolNamesProvider: () => [...config.tools],
      metadataProvider: () => ({
        handoffs: (config.handoffs || []).map(handoff => ({
          targetAgentName: handoff.targetAgentName,
          trigger: handoff.trigger || 'llm_tool_call',
          includeToolResults: handoff.includeToolResults ? [...handoff.includeToolResults] : undefined
        }))
      })
    });

    // Call custom init function directly if provided
    if (config.init) {
      config.init(this);
    }
  }

  /**
   * Get the tool instances for this agent
   */
  private getToolInstances(): Array<Tool<any, any>> {
    return this.config.tools
      .map(toolName => ToolRegistry.getToolInstance(toolName))
      .filter((tool): tool is Tool<any, any> => tool !== null);
  }

  /**
   * Prepare initial messages for the agent
   */
  private prepareInitialMessages(args: ConfigurableAgentArgs): ChatMessage[] {
    // Use custom message preparation function directly if provided
    if (this.config.prepareMessages) {
      return this.config.prepareMessages(args, this.config);
    }

    // Default implementation
    return [{
      entity: ChatMessageEntity.USER,
      text: args.query,
    }];
  }

  /**
   * Create a success result
   */
  private createSuccessResult(output: string, intermediateSteps: ChatMessage[], reason: AgentRunTerminationReason): ConfigurableAgentResult {
    // Use custom success result creation function directly
    if (this.config.createSuccessResult) {
      return this.config.createSuccessResult(output, intermediateSteps, reason, this.config);
    }

    // Default implementation
    const result: ConfigurableAgentResult = {
      success: true,
      output,
      terminationReason: reason
    };

    // Only include steps if the flag is explicitly true
    if (this.config.includeIntermediateStepsOnReturn === true) {
        result.intermediateSteps = intermediateSteps;
    }

    return result;
  }

  /**
   * Create an error result
   */
  private createErrorResult(error: string, intermediateSteps: ChatMessage[], reason: AgentRunTerminationReason): ConfigurableAgentResult {
    // Use custom error result creation function directly
    if (this.config.createErrorResult) {
      return this.config.createErrorResult(error, intermediateSteps, reason, this.config);
    }

    // Default implementation
    const result: ConfigurableAgentResult = {
      success: false,
      error,
      terminationReason: reason
    };

    // Only include steps if the flag is explicitly true
    if (this.config.includeIntermediateStepsOnReturn === true) {
        result.intermediateSteps = intermediateSteps;
    }

    return result;
  }

  /**
   * Execute the agent
   */
  async execute(args: ConfigurableAgentArgs, _ctx?: unknown): Promise<ConfigurableAgentResult & { agentSession: AgentSession }> {
    logger.info(`Executing ${this.name} via AgentRunner with args:`, args);

    // Get current tracing context for debugging
    const tracingContext = getCurrentTracingContext();
    const callCtx = (_ctx || {}) as CallCtx;
    const apiKey = callCtx.apiKey;
    const provider = callCtx.provider;

    // Check if API key is required based on provider
    // LiteLLM and BrowserOperator have optional API keys
    // Other providers (OpenAI, Groq, OpenRouter) require API keys
    const requiresApiKey = provider !== 'litellm' && provider !== 'browseroperator';

    if (requiresApiKey && !apiKey) {
      const errorResult = this.createErrorResult(`API key not configured for ${this.name}`, [], 'error');
      // Create minimal error session
      const errorSession: AgentSession = {
        agentName: this.name,
        agentQuery: args.query,
        agentReasoning: args.reasoning,
        sessionId: getRuntime().generateId(),
        status: 'error',
        startTime: getRuntime().now(),
        endTime: getRuntime().now(),
        messages: [],
        nestedSessions: [],
        tools: [],
        terminationReason: 'error'
      };
      return { ...errorResult, agentSession: errorSession };
    }

    // Execute beforeExecute lifecycle hook if defined
    if (this.config.beforeExecute) {
      try {
        await this.config.beforeExecute(callCtx);
      } catch (error) {
        logger.warn(`beforeExecute hook failed for ${this.name}:`, error);
        // Continue with agent execution even if beforeExecute fails
      }
    }

    // Initialize
    const maxIterations = this.config.maxIterations || 10;
    
    // Resolve model name from context or configuration
    let modelName: string;
    if (this.config.modelName === MODEL_SENTINELS.USE_MINI) {
      // Fall back to main model if mini model is not configured
      modelName = callCtx.miniModel || callCtx.mainModel || callCtx.model || '';
      if (!modelName) {
        throw new Error(`Mini model not provided in context for agent '${this.name}'. Ensure context includes miniModel or mainModel.`);
      }
    } else if (this.config.modelName === MODEL_SENTINELS.USE_NANO) {
      // Fall back through nano -> mini -> main model chain
      modelName = callCtx.nanoModel || callCtx.miniModel || callCtx.mainModel || callCtx.model || '';
      if (!modelName) {
        throw new Error(`Nano model not provided in context for agent '${this.name}'. Ensure context includes nanoModel, miniModel, or mainModel.`);
      }
    } else if (typeof this.config.modelName === 'function') {
      modelName = this.config.modelName();
    } else if (this.config.modelName) {
      modelName = this.config.modelName;
    } else {
      // Use main model from context, or fallback to context model
      const contextModel = callCtx.mainModel || callCtx.model;
      if (!contextModel) {
        throw new Error(`No model provided for agent '${this.name}'. Ensure context includes model or mainModel.`);
      }
      modelName = contextModel;
    }
    
    // Override with context model only if agent doesn't have its own model configuration
    if (callCtx.model && !this.config.modelName) {
      modelName = callCtx.model;
    }

    // Update context with resolved fallback models for tools to use
    // This ensures tools that check ctx.miniModel or ctx.nanoModel get the fallback
    if (this.config.modelName === MODEL_SENTINELS.USE_MINI && !callCtx.miniModel) {
      callCtx.miniModel = modelName;  // Use the resolved fallback
    }
    if (this.config.modelName === MODEL_SENTINELS.USE_NANO && !callCtx.nanoModel) {
      callCtx.nanoModel = modelName;  // Use the resolved fallback
    }

    // Validate required context
    if (!callCtx.provider) {
      throw new Error(`Provider not provided in context for agent '${this.name}'. Ensure context includes provider.`);
    }

    const temperature = this.config.temperature ?? 0;
    const systemPrompt = this.config.systemPrompt;
    const tools = this.getToolInstances();

    // Prepare initial messages
    const internalMessages = this.prepareInitialMessages(args);
    const runnerConfig: AgentRunnerConfig = {
      apiKey: apiKey || '',  // Use empty string if undefined for BrowserOperator
      modelName,
      systemPrompt,
      tools,
      maxIterations,
      temperature,
      provider: callCtx.provider,
      getVisionCapability: callCtx.getVisionCapability ?? (() => false),
      miniModel: callCtx.miniModel,
      nanoModel: callCtx.nanoModel,
      cdpAdapter: callCtx.cdpAdapter,
      onBeforeToolExecution: callCtx.onBeforeToolExecution,
    };

    const descriptor = await AgentDescriptorRegistry.getDescriptor(this.name);
    if (descriptor) {
      runnerConfig.agentDescriptor = descriptor;
      callCtx.agentDescriptor = descriptor;
    }

    const runnerHooks: AgentRunnerHooks = {
      prepareInitialMessages: undefined, // initial messages already prepared above
      createSuccessResult: this.config.createSuccessResult
        ? (out, steps, reason) => this.config.createSuccessResult!(out, steps, reason, this.config)
        : (out, steps, reason) => this.createSuccessResult(out, steps, reason),
      createErrorResult: this.config.createErrorResult
        ? (err, steps, reason) => this.config.createErrorResult!(err, steps, reason, this.config)
        : (err, steps, reason) => this.createErrorResult(err, steps, reason),
      // Wrap afterExecute to pass callCtx (AgentRunner doesn't have access to callCtx)
      afterExecute: this.config.afterExecute
        ? async (result, agentSession) => this.config.afterExecute!(result, agentSession, callCtx)
        : undefined,
    };

    // Run the agent
    const ctx: any = callCtx || {};
    const result = await AgentRunner.run(
      internalMessages,
      args,
      runnerConfig,
      runnerHooks,
      this, // executingAgent
      undefined,
      {
        sessionId: ctx.overrideSessionId,
        parentSessionId: ctx.overrideParentSessionId,
        traceId: ctx.overrideTraceId,
        background: ctx.background,
      },
      callCtx.abortSignal
    );

    // Note: afterExecute hook is handled by AgentRunner via runnerHooks
    // No need to call it here as it's already been executed

    // Return the direct result from the runner (including agentSession)
    return result;
  }
}
