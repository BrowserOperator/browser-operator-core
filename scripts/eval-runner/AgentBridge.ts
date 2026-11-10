/**
 * Agent Bridge - Executes real DevTools agents in eval runner context
 *
 * This bridges the CLI runner to the actual DevTools agent implementations.
 * Uses the same AgentRunner logic as DevTools, ensuring consistency.
 */

import path from 'path';
import type { TestCase, CLIOptions, ExecutionMetrics, ToolCallMetric, LLMCallMetric } from './types.ts';
import type { ExecutionContext } from './BrowserExecutor.ts';
import { DOMTestExecutor } from './DOMTestExecutor.ts';
import type { DOMTestCase } from './test-cases/dom-tests.ts';
import { DirectCDPAdapter } from '../../front_end/panels/ai_chat/cdp/DirectCDPAdapter.ts';
import { ToolRegistry } from '../../front_end/panels/ai_chat/agent_framework/ConfigurableAgentTool.ts';
import type { LLMProvider } from '../../front_end/panels/ai_chat/LLM/LLMTypes.ts';
import { initializeLLMForEval } from './lib/LLMInit.ts';
import { setupToolsForEval } from './lib/ToolSetup.ts';
import type { TestLogger } from './TestLogger.ts';
import { createLogger } from '../../front_end/panels/ai_chat/core/Logger.ts';

const logger = createLogger('AgentBridge');

interface AgentResult {
  success: boolean;
  output?: unknown;
  error?: string;
  actions?: ActionRecord[];
  iterations?: number;
  /** Detailed execution metrics for comparison */
  metrics?: ExecutionMetrics;
}

interface ActionRecord {
  action: string;
  target?: string;
  result?: string;
  timestamp: number;
}

/**
 * AgentBridge executes real DevTools agents for eval tests
 */
export class AgentBridge {
  private options: CLIOptions;
  private initialized = false;
  private domTestExecutor: DOMTestExecutor;

  constructor(options: CLIOptions) {
    this.options = options;
    this.domTestExecutor = new DOMTestExecutor();
  }

  /**
   * Initialize LLM client and register tools
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing...');

    // Initialize LLM with eval runner's config
    await initializeLLMForEval({
      provider: this.options.provider || 'openai',
      apiKey: this.options.apiKey || '',
      model: this.options.model,
      providerURL: this.options.providerURL,
    });

    // Register all DevTools tools/agents
    await setupToolsForEval();

    this.initialized = true;
    logger.info('Initialization complete');
  }

  /**
   * Execute a test case using the real DevTools agent
   */
  async execute(testCase: TestCase, context: ExecutionContext, logger?: TestLogger): Promise<AgentResult> {
    // Handle DOM tests separately (they don't use agents)
    if (testCase.tool === 'dom_test') {
      return this.executeDOMTest(testCase as DOMTestCase, context);
    }

    // Get the real DevTools agent from registry (use toolOverride if specified)
    const toolName = this.options.toolOverride || testCase.tool;
    if (this.options.toolOverride && this.options.toolOverride !== testCase.tool) {
      logger?.logExecution(`Using tool override: ${this.options.toolOverride} (original: ${testCase.tool})`);
    }
    const agent = ToolRegistry.getRegisteredTool(toolName);
    if (!agent) {
      const error = `Unknown agent: ${toolName}. Available: ${ToolRegistry.getRegisteredToolNames().join(', ')}`;
      logger?.logExecution(`Agent error: ${error}`);
      return {
        success: false,
        error,
      };
    }

    // Create adapter for this execution context
    const adapter = new DirectCDPAdapter(context.cdp as any, context.page.url());

    try {
      // Prepare input based on test case type
      const input = this.prepareAgentInput(testCase);
      logger?.logExecution(`Agent input: ${JSON.stringify(input, null, 2)}`);

      const startTime = Date.now();

      // Execute with full CallCtx including CDP adapter and screenshot callback
      const result = await agent.execute(input, {
        apiKey: this.options.apiKey || '',
        provider: (this.options.provider || 'openai') as LLMProvider,
        model: this.options.model,
        miniModel: this.options.model,
        nanoModel: this.options.model,
        cdpAdapter: adapter,

        // Capture screenshot before each tool execution
        onBeforeToolExecution: async (toolName: string, _toolArgs: unknown) => {
          const testDir = logger?.getTestDir();
          // Check page exists and is not closed
          if (testDir && context.page && !context.page.isClosed()) {
            // Use TestLogger's counter to persist across agent executions
            const num = logger?.getNextScreenshotNumber() ?? 1;
            const filename = `action-${num.toString().padStart(3, '0')}-${toolName}.png`;
            const screenshotPath = path.join(testDir, filename);
            try {
              await context.page.screenshot({ path: screenshotPath, fullPage: true });
              logger?.logExecution(`Screenshot captured: ${filename}`);
            } catch (err) {
              // Only log errors that aren't related to closed pages/sessions
              const errStr = String(err);
              if (!errStr.includes('Target closed') && !errStr.includes('Session closed')) {
                logger?.logExecution(`Screenshot failed: ${err}`);
              }
            }
          }
        },
      });

      const durationMs = Date.now() - startTime;

      // Log tool calls from the agent session messages
      if (logger && result.agentSession?.messages) {
        // Build a map of tool call IDs to their results
        const toolResultMap = new Map<string, any>();
        for (const message of result.agentSession.messages) {
          if (message.type === 'tool_result') {
            const resultContent = message.content as any;
            toolResultMap.set(resultContent.toolCallId, resultContent);
          }
        }

        // Log each tool call with its result
        for (const message of result.agentSession.messages) {
          if (message.type === 'tool_call') {
            const toolCall = message.content as any;
            const toolResult = toolResultMap.get(toolCall.toolCallId);

            logger.logToolCall(
              toolCall.toolName || 'unknown',
              toolCall.toolArgs,
              toolResult?.result,
              toolResult?.duration || 0,
              toolResult?.error
            );
          }
        }
      }

      const mapped = this.mapAgentResult(result, testCase);
      logger?.logExecution(`Agent completed in ${durationMs}ms: ${mapped.success ? 'SUCCESS' : 'FAILED'}`);
      if (mapped.error) {
        logger?.logExecution(`Agent error: ${mapped.error}`);
      }

      return mapped;
    } catch (error) {
      logger?.logExecution(`Agent exception: ${error}`);
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Execute DOM test using DOMTestExecutor
   */
  private async executeDOMTest(
    testCase: DOMTestCase,
    context: ExecutionContext
  ): Promise<AgentResult> {
    const result = await this.domTestExecutor.execute(testCase, context);

    return {
      success: result.success,
      output: {
        assertions: result.assertions,
        data: result.data,
      },
      error: result.error,
      iterations: 1,
    };
  }

  /**
   * Prepare agent input based on test case type
   */
  private prepareAgentInput(testCase: TestCase): Record<string, unknown> {
    const input = testCase.input as Record<string, unknown>;

    switch (testCase.tool) {
      case 'action_agent':
      case 'action_agent_v1':
      case 'action_agent_v2':
        // ActionAgent expects: { objective, reasoning, hint?, input_data? }
        return {
          objective: input.objective || input.query || '',
          reasoning: input.reasoning || 'Eval runner test',
          hint: input.hint,
          input_data: input.input_data,
        };

      case 'web_task_agent':
        // WebTaskAgent expects: { task: string, reasoning: string, extraction_schema?: object }
        return {
          task: input.task || input.query || '',
          reasoning: input.reasoning || 'Eval runner test',
          extraction_schema: input.extraction_schema,
        };

      case 'research_agent':
        // ResearchAgent expects: { query: string }
        return {
          query: input.query || '',
        };

      case 'search':
        // SearchTool expects: { query, site, maxResults?, strategy?, reasoning }
        // Inject strategy from CLI options if not specified in test case
        return {
          query: input.query || '',
          site: input.site || '',
          maxResults: input.maxResults || 10,
          strategy: input.strategy || this.options.searchStrategy,
          reasoning: input.reasoning || 'Eval runner test',
          forceRefresh: input.forceRefresh,
        };

      default:
        // Pass through as-is for other agents
        return input;
    }
  }

  /**
   * Map ConfigurableAgentResult → AgentResult for eval
   */
  private mapAgentResult(result: any, testCase: TestCase): AgentResult {
    // Handle error results
    if (result.error) {
      return {
        success: false,
        error: result.error,
        iterations: result.agentSession?.iterationCount || 1,
        metrics: this.buildMetrics(result),
      };
    }

    // Extract actions from agent session
    const actions: ActionRecord[] = [];
    if (result.agentSession?.toolCalls) {
      for (const toolCall of result.agentSession.toolCalls) {
        actions.push({
          action: toolCall.toolName || 'unknown',
          target: toolCall.toolArgs?.nodeId ? `nodeId: ${toolCall.toolArgs.nodeId}` :
                  toolCall.toolArgs?.xpath ? `xpath: ${toolCall.toolArgs.xpath}` :
                  undefined,
          result: toolCall.result ? 'success' : 'failed',
          timestamp: Date.now(),
        });
      }
    }

    // Determine success based on result structure
    // Tools return raw values - if there's no explicit error, treat as success
    const success = result.success !== undefined ? result.success :
                   (result.error === undefined || result.error === null);

    return {
      success: Boolean(success),
      output: result.output || result.message || result,
      actions,
      iterations: result.agentSession?.iterationCount || 1,
      metrics: this.buildMetrics(result),
    };
  }

  /**
   * Build execution metrics from agent session for comparison
   */
  private buildMetrics(result: any): ExecutionMetrics {
    const session = result.agentSession;
    const nativeMetrics = session?.metrics;

    // Use native metrics if available (preferred - tracked during execution)
    if (nativeMetrics) {
      return {
        toolCalls: [], // Detailed tool call list not needed for comparison
        llmCalls: [],  // Detailed LLM call list not needed for comparison
        totalToolCalls: nativeMetrics.toolCallCount || 0,
        totalLLMCalls: nativeMetrics.llmCallCount || 0,
        totalDurationMs: nativeMetrics.totalDurationMs || 0,
        totalTokens: nativeMetrics.totalTokens || 0,
        promptTokens: nativeMetrics.promptTokens || 0,
        completionTokens: nativeMetrics.completionTokens || 0,
        iterations: session?.iterationCount || 1,
        toolCallsByName: nativeMetrics.toolCallsByName || {},
      };
    }

    // Fallback: Reconstruct metrics from messages for backward compatibility
    return this.reconstructMetricsFromMessages(result);
  }

  /**
   * Reconstruct metrics from session messages (fallback for older sessions)
   */
  private reconstructMetricsFromMessages(result: any): ExecutionMetrics {
    const toolCalls: ToolCallMetric[] = [];
    const llmCalls: LLMCallMetric[] = [];
    const toolCallsByName: Record<string, number> = {};

    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;

    // Extract tool calls from agent session messages
    if (result.agentSession?.messages) {
      // Build a map of tool call IDs to their results for duration tracking
      const toolResultMap = new Map<string, any>();
      for (const message of result.agentSession.messages) {
        if (message.type === 'tool_result') {
          const resultContent = message.content as any;
          toolResultMap.set(resultContent.toolCallId, resultContent);
        }
      }

      // Process tool calls
      for (const message of result.agentSession.messages) {
        if (message.type === 'tool_call') {
          const toolCall = message.content as any;
          const toolResult = toolResultMap.get(toolCall.toolCallId);
          const toolName = toolCall.toolName || 'unknown';

          toolCalls.push({
            name: toolName,
            durationMs: toolResult?.duration || 0,
            success: !toolResult?.error,
            error: toolResult?.error,
          });

          // Count by name
          toolCallsByName[toolName] = (toolCallsByName[toolName] || 0) + 1;
        }

        // Extract LLM call metrics from assistant messages
        if (message.type === 'assistant' && message.usage) {
          const usage = message.usage;
          llmCalls.push({
            durationMs: message.duration || 0,
            promptTokens: usage.promptTokens || usage.input_tokens || 0,
            completionTokens: usage.completionTokens || usage.output_tokens || 0,
            totalTokens: (usage.promptTokens || usage.input_tokens || 0) +
                        (usage.completionTokens || usage.output_tokens || 0),
            toolCallsRequested: message.toolCalls?.length || 0,
          });

          promptTokens += usage.promptTokens || usage.input_tokens || 0;
          completionTokens += usage.completionTokens || usage.output_tokens || 0;
        }
      }
    }

    totalTokens = promptTokens + completionTokens;

    // Calculate total duration from tool calls
    const totalDurationMs = toolCalls.reduce((sum, tc) => sum + tc.durationMs, 0);

    return {
      toolCalls,
      llmCalls,
      totalToolCalls: toolCalls.length,
      totalLLMCalls: llmCalls.length,
      totalDurationMs,
      totalTokens,
      promptTokens,
      completionTokens,
      iterations: result.agentSession?.iterationCount || 1,
      toolCallsByName,
    };
  }
}
