// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from './Logger.js';
import { ConfigurableAgentTool, type AgentToolConfig, type ConfigurableAgentResult, type CallCtx } from '../agent_framework/ConfigurableAgentTool.js';
import type { ChatMessage } from '../models/ChatTypes.js';

const logger = createLogger('AgentTestRunner');

/**
 * Input for running an agent test
 */
export interface AgentTestInput {
  agentConfig: AgentToolConfig;
  userInput: string;
  context?: Partial<CallCtx>;
}

/**
 * Message in test execution history
 */
export interface TestMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  timestamp: number;
}

/**
 * Result from an agent test run
 */
export interface AgentTestResult {
  success: boolean;
  output?: string;
  error?: string;
  messages: TestMessage[];
  iterations: number;
  duration: number;
  terminationReason?: string;
}

/**
 * Test execution state
 */
interface TestExecutionState {
  abortController: AbortController;
  startTime: number;
  messages: TestMessage[];
  iterations: number;
}

const DEFAULT_TEST_TIMEOUT = 60000; // 60 seconds
const MAX_TEST_ITERATIONS = 20;

/**
 * AgentTestRunner - Executes agent tests for Agent Studio
 *
 * Provides manual test execution capabilities with:
 * - Configurable timeout
 * - Execution history capture
 * - Cancellation support
 */
export class AgentTestRunner {
  private currentTest: TestExecutionState | null = null;

  /**
   * Run a test execution for an agent
   */
  async runTest(input: AgentTestInput, timeout = DEFAULT_TEST_TIMEOUT): Promise<AgentTestResult> {
    logger.info('Starting agent test', { agentName: input.agentConfig.name });

    // Initialize test state
    const state: TestExecutionState = {
      abortController: new AbortController(),
      startTime: Date.now(),
      messages: [],
      iterations: 0,
    };

    this.currentTest = state;

    // Set up timeout
    const timeoutId = setTimeout(() => {
      state.abortController.abort();
    }, timeout);

    try {
      // Create agent instance with limited iterations for testing
      const testConfig: AgentToolConfig = {
        ...input.agentConfig,
        maxIterations: Math.min(input.agentConfig.maxIterations || 10, MAX_TEST_ITERATIONS),
        // Include intermediate steps so we can see what happened
        includeIntermediateStepsOnReturn: true,
      };

      const agent = new ConfigurableAgentTool(testConfig);

      // Add initial user message
      state.messages.push({
        role: 'user',
        content: input.userInput,
        timestamp: Date.now(),
      });

      // Build execution context
      const callCtx: CallCtx = {
        ...input.context,
        abortSignal: state.abortController.signal,
      };

      // Execute the agent
      const result = await agent.execute(
        {
          query: input.userInput,
          reasoning: 'Test execution from Agent Studio',
        },
        callCtx
      );

      // Process result
      const testResult = this.processResult(result, state);

      logger.info('Agent test completed', {
        agentName: input.agentConfig.name,
        success: testResult.success,
        duration: testResult.duration,
      });

      return testResult;
    } catch (error) {
      const duration = Date.now() - state.startTime;

      if (state.abortController.signal.aborted) {
        return {
          success: false,
          error: 'Test execution timed out',
          messages: state.messages,
          iterations: state.iterations,
          duration,
          terminationReason: 'timeout',
        };
      }

      logger.error('Agent test failed:', error);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        messages: state.messages,
        iterations: state.iterations,
        duration,
        terminationReason: 'error',
      };
    } finally {
      clearTimeout(timeoutId);
      this.currentTest = null;
    }
  }

  /**
   * Cancel the currently running test
   */
  cancelTest(): boolean {
    if (this.currentTest) {
      this.currentTest.abortController.abort();
      logger.info('Test execution cancelled');
      return true;
    }
    return false;
  }

  /**
   * Check if a test is currently running
   */
  isRunning(): boolean {
    return this.currentTest !== null;
  }

  /**
   * Process agent result into test result
   */
  private processResult(result: ConfigurableAgentResult & { agentSession?: any }, state: TestExecutionState): AgentTestResult {
    const duration = Date.now() - state.startTime;

    // Extract messages from intermediate steps
    if (result.intermediateSteps) {
      for (const step of result.intermediateSteps) {
        state.messages.push(this.convertChatMessage(step));
        state.iterations++;
      }
    }

    // Add final output
    if (result.success && result.output) {
      state.messages.push({
        role: 'assistant',
        content: result.output,
        timestamp: Date.now(),
      });
    }

    return {
      success: result.success,
      output: result.output,
      error: result.error,
      messages: state.messages,
      iterations: Math.ceil(state.iterations / 2), // Roughly estimate iterations
      duration,
      terminationReason: result.terminationReason,
    };
  }

  /**
   * Convert ChatMessage to TestMessage
   */
  private convertChatMessage(msg: ChatMessage): TestMessage {
    let content = '';
    let toolName: string | undefined;

    // Extract content based on message type
    if (msg.entity === 'user') {
      content = (msg as { text: string }).text || '';
    } else if (msg.entity === 'model') {
      const modelMsg = msg as { answer?: string; toolName?: string };
      content = modelMsg.answer || '';
      toolName = modelMsg.toolName;
    } else if (msg.entity === 'tool_result') {
      const toolMsg = msg as { resultText: string; toolName: string };
      content = toolMsg.resultText || '';
      toolName = toolMsg.toolName;
    }

    return {
      role: this.mapEntity(msg.entity),
      content,
      toolName,
      timestamp: Date.now(),
    };
  }

  /**
   * Map ChatMessageEntity to test message role
   */
  private mapEntity(entity: string): 'user' | 'assistant' | 'tool' {
    // ChatMessageEntity enum values:
    // USER = 'user', MODEL = 'model', TOOL_RESULT = 'tool_result'
    switch (entity) {
      case 'user':
        return 'user';
      case 'model':
        return 'assistant';
      case 'tool_result':
        return 'tool';
      default:
        return 'assistant';
    }
  }

  /**
   * Format test result as HTML for display
   */
  static formatResultAsHTML(result: AgentTestResult): string {
    const statusClass = result.success ? 'success' : 'error';
    const statusIcon = result.success ? '✓' : '✗';

    let html = `
      <div class="test-result ${statusClass}">
        <div class="test-status">
          <span class="status-icon">${statusIcon}</span>
          <span class="status-text">${result.success ? 'Success' : 'Failed'}</span>
          <span class="test-meta">
            ${result.iterations} iterations • ${(result.duration / 1000).toFixed(1)}s
          </span>
        </div>
    `;

    if (result.error) {
      html += `
        <div class="test-error">
          <strong>Error:</strong> ${escapeHTML(result.error)}
        </div>
      `;
    }

    if (result.output) {
      html += `
        <div class="test-output">
          <strong>Output:</strong>
          <pre>${escapeHTML(result.output)}</pre>
        </div>
      `;
    }

    if (result.messages.length > 0) {
      html += `
        <div class="test-messages">
          <strong>Execution History:</strong>
          <div class="messages-list">
      `;

      for (const msg of result.messages) {
        const roleClass = msg.role === 'tool' ? 'tool-message' : `${msg.role}-message`;
        const roleLabel = msg.role === 'tool' ? `Tool: ${msg.toolName || 'unknown'}` : msg.role;

        html += `
          <div class="message ${roleClass}">
            <span class="message-role">${roleLabel}</span>
            <span class="message-content">${escapeHTML(msg.content.substring(0, 500))}${msg.content.length > 500 ? '...' : ''}</span>
          </div>
        `;
      }

      html += `
          </div>
        </div>
      `;
    }

    html += '</div>';

    return html;
  }

  /**
   * Get CSS for test result display
   */
  static getResultCSS(): string {
    return `
      .test-result {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
      }

      .test-status {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid #e0e0e0;
      }

      .status-icon {
        font-size: 16px;
      }

      .test-result.success .status-icon {
        color: #4caf50;
      }

      .test-result.error .status-icon {
        color: #f44336;
      }

      .status-text {
        font-weight: 600;
      }

      .test-result.success .status-text {
        color: #4caf50;
      }

      .test-result.error .status-text {
        color: #f44336;
      }

      .test-meta {
        color: #666;
        font-size: 12px;
        margin-left: auto;
      }

      .test-error {
        background: #ffebee;
        color: #c62828;
        padding: 8px 12px;
        border-radius: 4px;
        margin-bottom: 12px;
      }

      .test-output {
        margin-bottom: 12px;
      }

      .test-output pre {
        background: #f5f5f5;
        padding: 12px;
        border-radius: 4px;
        overflow-x: auto;
        margin-top: 4px;
        white-space: pre-wrap;
        word-wrap: break-word;
      }

      .test-messages {
        margin-top: 12px;
      }

      .messages-list {
        max-height: 200px;
        overflow-y: auto;
        margin-top: 8px;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
      }

      .message {
        padding: 8px 12px;
        border-bottom: 1px solid #f0f0f0;
        display: flex;
        gap: 8px;
      }

      .message:last-child {
        border-bottom: none;
      }

      .message-role {
        font-weight: 500;
        min-width: 80px;
        color: #666;
        text-transform: capitalize;
      }

      .user-message .message-role {
        color: #1976d2;
      }

      .assistant-message .message-role {
        color: #7b1fa2;
      }

      .tool-message .message-role {
        color: #388e3c;
      }

      .message-content {
        flex: 1;
        color: #333;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `;
  }
}

/**
 * Helper to escape HTML
 */
function escapeHTML(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
