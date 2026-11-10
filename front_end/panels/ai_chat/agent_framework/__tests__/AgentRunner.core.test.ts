// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Core tests for AgentRunner execution loop.
 * Tests basic tool execution, iteration handling, termination reasons,
 * abort signal handling, and session metadata.
 */

import { AgentRunner } from '../AgentRunner.js';
import type { AgentRunnerConfig, AgentRunnerHooks } from '../AgentRunner.js';
import { ChatMessageEntity, type ChatMessage, type ToolResultMessage } from '../../models/ChatTypes.js';
import { AIChatPanel } from '../../ui/AIChatPanel.js';
import { LLMClient } from '../../LLM/LLMClient.js';
import type { Tool } from '../../tools/Tools.js';

// ============================================================================
// Test Setup Helpers
// ============================================================================

function stubAIChatPanel(): void {
  (AIChatPanel as any).getProviderForModel = (_model: string) => 'openai';
  (AIChatPanel as any).isVisionCapable = async (_model: string) => false;
}

function createMockTool<T>(name: string, executeFn: (args: T) => Promise<any>): Tool<any, any> {
  return {
    name,
    description: `Mock tool ${name}`,
    schema: { type: 'object', properties: {} },
    execute: executeFn,
  };
}

function createMockToolWithResult(name: string, result: any): Tool<any, any> {
  return createMockTool(name, async () => result);
}

function createMockToolWithError(name: string, errorMessage: string): Tool<any, any> {
  return createMockTool(name, async () => {
    throw new Error(errorMessage);
  });
}

interface TrackedMockTool extends Tool<any, any> {
  calls: Array<{ args: any }>;
}

function createTrackedMockTool(name: string, result: any): TrackedMockTool {
  const calls: Array<{ args: any }> = [];
  const tool = createMockTool(name, async (args: any) => {
    calls.push({ args });
    return result;
  }) as TrackedMockTool;
  tool.calls = calls;
  return tool;
}

function createDefaultConfig(tools: Tool<any, any>[] = []): AgentRunnerConfig {
  return {
    apiKey: 'test-api-key',
    modelName: 'gpt-4.1-2025-04-14',
    systemPrompt: 'You are a helpful assistant.',
    tools,
    maxIterations: 10,
    temperature: 0,
    provider: 'openai',
  };
}

function createDefaultHooks(): AgentRunnerHooks {
  return {
    prepareInitialMessages: undefined,
    createSuccessResult: (output, steps, reason) => ({
      success: true,
      output,
      terminationReason: reason,
      intermediateSteps: steps,
    }),
    createErrorResult: (error, steps, reason) => ({
      success: false,
      error,
      terminationReason: reason,
      intermediateSteps: steps,
    }),
  };
}

function createUserMessage(text: string): ChatMessage {
  return {
    entity: ChatMessageEntity.USER,
    text,
    id: `test-msg-${Date.now()}`,
    timestamp: new Date(),
  } as ChatMessage;
}

function createMockAgentArgs(args: { query: string; reasoning?: string }): { query: string; reasoning: string } {
  return {
    query: args.query,
    reasoning: args.reasoning || '',
  };
}

type MockLLMResponse =
  | { type: 'tool_call'; toolName: string; toolArgs: any }
  | { type: 'final_answer'; answer: string }
  | { type: 'error'; error: string };

class MockLLMClient {
  private responseQueue: MockLLMResponse[] = [];
  private callCount = 0;
  private defaultResponse: MockLLMResponse | null = null;
  private originalGetInstance: any;

  queueResponse(response: MockLLMResponse): void {
    this.responseQueue.push(response);
  }

  setDefaultResponse(response: MockLLMResponse): void {
    this.defaultResponse = response;
  }

  install(): () => void {
    this.originalGetInstance = (LLMClient as any).getInstance;
    (LLMClient as any).getInstance = () => this.createFakeClient();
    return () => {
      (LLMClient as any).getInstance = this.originalGetInstance;
    };
  }

  assertCallCount(expected: number): void {
    assert.strictEqual(this.callCount, expected, `Expected ${expected} LLM calls, got ${this.callCount}`);
  }

  private createFakeClient() {
    return {
      call: async () => {
        this.callCount++;
        return { rawResponse: { callNumber: this.callCount } };
      },
      parseResponse: () => {
        const response = this.responseQueue.shift() || this.defaultResponse;
        if (!response) {
          return { type: 'error', error: 'No more mock responses' };
        }

        if (response.type === 'tool_call') {
          return { type: 'tool_call', name: response.toolName, args: response.toolArgs };
        }
        if (response.type === 'final_answer') {
          return { type: 'final_answer', answer: response.answer };
        }
        return { type: 'error', error: response.error };
      },
    };
  }
}

function setupMockLLMClient(responses: MockLLMResponse[]): { client: MockLLMClient; cleanup: () => void } {
  const client = new MockLLMClient();
  for (const response of responses) {
    client.queueResponse(response);
  }
  const cleanup = client.install();
  return { client, cleanup };
}

function createTestAbortController(): { controller: AbortController; signal: AbortSignal } {
  const controller = new AbortController();
  return { controller, signal: controller.signal };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Assertion helpers
function assertSuccessResult(result: any): void {
  assert.isTrue(result.success, `Expected success but got error: ${result.error}`);
}

function assertErrorResult(result: any, expectedMessage?: string): void {
  assert.isFalse(result.success, 'Expected error result but got success');
  if (expectedMessage) {
    assert.include(result.error || '', expectedMessage);
  }
}

function assertTerminationReason(result: any, expected: string): void {
  assert.strictEqual(result.terminationReason, expected);
}

function assertToolCalled(steps: ChatMessage[], toolName: string): void {
  const toolCall = steps.find(
    (m) => m.entity === ChatMessageEntity.MODEL && (m as any).action === 'tool' && (m as any).toolName === toolName
  );
  assert.isOk(toolCall, `Expected tool ${toolName} to be called`);
}

function assertFinalAnswer(steps: ChatMessage[]): void {
  const final = steps.find(
    (m) => m.entity === ChatMessageEntity.MODEL && (m as any).action === 'final'
  );
  assert.isOk(final, 'Expected final answer in steps');
}

// ============================================================================
// Tests
// ============================================================================

describe('ai_chat: AgentRunner.core', () => {
  let mockLLMCleanup: (() => void) | null = null;

  beforeEach(() => {
    stubAIChatPanel();
  });

  afterEach(() => {
    if (mockLLMCleanup) {
      mockLLMCleanup();
      mockLLMCleanup = null;
    }
  });

  // ==========================================================================
  // Basic Execution Flow Tests
  // ==========================================================================

  describe('basic execution flow', () => {
    it('executes single tool call and returns final answer', async () => {
      const echoTool = createMockToolWithResult('echo_tool', { echoed: true });
      const { client, cleanup } = setupMockLLMClient([
        { type: 'tool_call', toolName: 'echo_tool', toolArgs: { message: 'hello' } },
        { type: 'final_answer', answer: 'Echo completed!' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createDefaultConfig([echoTool]);
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Please echo hello')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Echo hello' }),
        config,
        hooks,
        null
      );

      assertSuccessResult(result);
      assertTerminationReason(result, 'final_answer');
      assert.strictEqual(result.output, 'Echo completed!');
      client.assertCallCount(2); // One for tool call, one for final answer
    });

    it('executes multiple sequential tool calls before final answer', async () => {
      const tool1 = createTrackedMockTool('tool_1', { step: 1 });
      const tool2 = createTrackedMockTool('tool_2', { step: 2 });
      const tool3 = createTrackedMockTool('tool_3', { step: 3 });

      const { cleanup } = setupMockLLMClient([
        { type: 'tool_call', toolName: 'tool_1', toolArgs: { a: 1 } },
        { type: 'tool_call', toolName: 'tool_2', toolArgs: { b: 2 } },
        { type: 'tool_call', toolName: 'tool_3', toolArgs: { c: 3 } },
        { type: 'final_answer', answer: 'All three tools executed' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createDefaultConfig([tool1, tool2, tool3]);
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Run all tools')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Run all tools' }),
        config,
        hooks,
        null
      );

      assertSuccessResult(result);
      assert.strictEqual(tool1.calls.length, 1);
      assert.strictEqual(tool2.calls.length, 1);
      assert.strictEqual(tool3.calls.length, 1);
      assert.deepStrictEqual(tool1.calls[0].args, { a: 1 });
      assert.deepStrictEqual(tool2.calls[0].args, { b: 2 });
      assert.deepStrictEqual(tool3.calls[0].args, { c: 3 });
    });

    it('returns final answer immediately when no tools are called', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Direct answer without tools' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createDefaultConfig([]);
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('What is 2+2?')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'What is 2+2?' }),
        config,
        hooks,
        null
      );

      assertSuccessResult(result);
      assert.strictEqual(result.output, 'Direct answer without tools');
      assertTerminationReason(result, 'final_answer');
    });
  });

  // ==========================================================================
  // Tool Execution Error Handling
  // ==========================================================================

  describe('tool execution error handling', () => {
    it('handles tool execution errors gracefully and continues', async () => {
      const failingTool = createMockToolWithError('failing_tool', 'Tool crashed!');
      const { cleanup } = setupMockLLMClient([
        { type: 'tool_call', toolName: 'failing_tool', toolArgs: {} },
        { type: 'final_answer', answer: 'Recovered from tool error' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createDefaultConfig([failingTool]);
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Try the tool')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Try the tool' }),
        config,
        hooks,
        null
      );

      // Agent should recover and provide final answer
      assertSuccessResult(result);
      assert.strictEqual(result.output, 'Recovered from tool error');

      // Check that error was captured in intermediate steps
      const toolResultMessages = result.intermediateSteps?.filter(
        (m) => m.entity === ChatMessageEntity.TOOL_RESULT
      ) as ToolResultMessage[] || [];

      const errorResult = toolResultMessages.find(m => m.isError);
      assert.isOk(errorResult, 'Should have an error tool result');
      assert.include(errorResult?.resultText || '', 'Tool crashed!');
    });

    it('handles unknown tool gracefully', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'tool_call', toolName: 'nonexistent_tool', toolArgs: {} },
        { type: 'final_answer', answer: 'Recovered from unknown tool' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createDefaultConfig([]); // No tools registered
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Use unknown tool')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Use unknown tool' }),
        config,
        hooks,
        null
      );

      // Agent should recover
      assertSuccessResult(result);
    });
  });

  // ==========================================================================
  // Iteration Limit Tests
  // ==========================================================================

  describe('iteration limits', () => {
    it('respects maxIterations limit', async () => {
      // Keep returning tool calls forever
      const client = new MockLLMClient();
      client.setDefaultResponse({ type: 'tool_call', toolName: 'infinite_tool', toolArgs: {} });
      mockLLMCleanup = client.install();

      const infiniteTool = createMockToolWithResult('infinite_tool', { done: false });
      const config = createDefaultConfig([infiniteTool]);
      config.maxIterations = 3; // Limit to 3 iterations
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Loop forever')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Loop forever' }),
        config,
        hooks,
        null
      );

      // Should fail with max_iterations
      assertErrorResult(result);
      assertTerminationReason(result, 'max_iterations');
      assert.include(result.error || '', 'maximum iterations');
    });

    it('tracks iteration count correctly in session', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'tool_call', toolName: 'tool1', toolArgs: {} },
        { type: 'tool_call', toolName: 'tool1', toolArgs: {} },
        { type: 'final_answer', answer: 'Done after 2 tool calls' },
      ]);
      mockLLMCleanup = cleanup;

      const tool = createMockToolWithResult('tool1', { ok: true });
      const config = createDefaultConfig([tool]);
      config.maxIterations = 10;
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Run twice')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Run twice' }),
        config,
        hooks,
        null
      );

      assertSuccessResult(result);
      // Session should track iterations (3 iterations: 2 tool calls + 1 final)
      assert.strictEqual(result.agentSession.iterationCount, 3);
    });
  });

  // ==========================================================================
  // Abort Signal Tests
  // ==========================================================================

  describe('abort signal handling', () => {
    it('handles abort signal during execution', async () => {
      const { controller, signal } = createTestAbortController();

      // Create a slow tool that gives us time to abort
      const slowTool = createMockTool('slow_tool', async () => {
        await delay(100);
        return { completed: true };
      });

      // Queue tool call then final answer
      const { cleanup } = setupMockLLMClient([
        { type: 'tool_call', toolName: 'slow_tool', toolArgs: {} },
        { type: 'final_answer', answer: 'Should not reach here' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createDefaultConfig([slowTool]);
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Run slow tool')];

      // Start execution
      const runPromise = AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Run slow tool' }),
        config,
        hooks,
        null,
        undefined,
        undefined,
        signal
      );

      // Abort after a short delay
      await delay(20);
      controller.abort();

      const result = await runPromise;

      // Should be aborted
      assertErrorResult(result, 'cancelled');
      assertTerminationReason(result, 'error');
    });

    it('handles pre-aborted signal', async () => {
      const { controller, signal } = createTestAbortController();
      controller.abort(); // Pre-abort

      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Should not execute' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createDefaultConfig([]);
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Test')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Test' }),
        config,
        hooks,
        null,
        undefined,
        undefined,
        signal
      );

      assertErrorResult(result, 'cancelled');
    });
  });

  // ==========================================================================
  // Session Metadata Tests
  // ==========================================================================

  describe('session metadata', () => {
    it('creates session with correct agent name', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createDefaultConfig([]);
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Test')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Test' }),
        config,
        hooks,
        null // No executing agent, should use 'Unknown'
      );

      assert.strictEqual(result.agentSession.agentName, 'Unknown');
      assert.isOk(result.agentSession.sessionId);
      assert.strictEqual(result.agentSession.status, 'completed');
    });

    it('tracks start and end time', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createDefaultConfig([]);
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Test')];

      const startTime = new Date();
      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Test' }),
        config,
        hooks,
        null
      );
      const endTime = new Date();

      assert.isOk(result.agentSession.startTime);
      assert.isOk(result.agentSession.endTime);
      assert.isTrue(result.agentSession.startTime >= startTime);
      assert.isTrue(result.agentSession.endTime! <= endTime);
    });

    it('records model used in session', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createDefaultConfig([]);
      config.modelName = 'custom-model-v1';
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Test')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Test' }),
        config,
        hooks,
        null
      );

      assert.strictEqual(result.agentSession.modelUsed, 'custom-model-v1');
    });

    it('records tools available in session', async () => {
      const tool1 = createMockToolWithResult('tool_a', {});
      const tool2 = createMockToolWithResult('tool_b', {});

      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createDefaultConfig([tool1, tool2]);
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Test')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Test' }),
        config,
        hooks,
        null
      );

      assert.deepStrictEqual(result.agentSession.tools, ['tool_a', 'tool_b']);
    });
  });

  // ==========================================================================
  // Termination Reason Tests
  // ==========================================================================

  describe('termination reasons', () => {
    it('terminates with final_answer on normal completion', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Task completed' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createDefaultConfig([]);
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Complete the task')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Complete the task' }),
        config,
        hooks,
        null
      );

      assertSuccessResult(result);
      assertTerminationReason(result, 'final_answer');
      assert.strictEqual(result.agentSession.terminationReason, 'final_answer');
    });

    it('terminates with max_iterations at limit', async () => {
      const client = new MockLLMClient();
      client.setDefaultResponse({ type: 'tool_call', toolName: 'loop_tool', toolArgs: {} });
      mockLLMCleanup = client.install();

      const tool = createMockToolWithResult('loop_tool', { ok: true });
      const config = createDefaultConfig([tool]);
      config.maxIterations = 2;
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Loop')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Loop' }),
        config,
        hooks,
        null
      );

      assertErrorResult(result);
      assertTerminationReason(result, 'max_iterations');
      assert.strictEqual(result.agentSession.terminationReason, 'max_iterations');
    });

    it('terminates with error on LLM failure', async () => {
      // Make LLM throw an error
      (LLMClient as any).getInstance = () => ({
        call: async () => { throw new Error('LLM service unavailable'); },
        parseResponse: () => ({ type: 'error', error: 'n/a' }),
      });
      mockLLMCleanup = () => {};

      const config = createDefaultConfig([]);
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Test')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Test' }),
        config,
        hooks,
        null
      );

      assertErrorResult(result, 'LLM call failed');
      assertTerminationReason(result, 'error');
      assert.strictEqual(result.agentSession.terminationReason, 'error');
    });
  });

  // ==========================================================================
  // Intermediate Steps Tests
  // ==========================================================================

  describe('intermediate steps', () => {
    it('includes intermediate steps in result', async () => {
      const tool = createMockToolWithResult('step_tool', { data: 'step_result' });

      const { cleanup } = setupMockLLMClient([
        { type: 'tool_call', toolName: 'step_tool', toolArgs: { input: 'test' } },
        { type: 'final_answer', answer: 'Final result' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createDefaultConfig([tool]);
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Run with steps')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Run with steps' }),
        config,
        hooks,
        null
      );

      assertSuccessResult(result);
      assert.isArray(result.intermediateSteps);

      // Should have: user message, tool call, tool result, final answer
      assert.isAtLeast(result.intermediateSteps!.length, 3);

      // Verify tool call is in steps
      assertToolCalled(result.intermediateSteps!, 'step_tool');

      // Verify final answer is in steps
      assertFinalAnswer(result.intermediateSteps!);
    });
  });

  // ==========================================================================
  // Image Data Handling Tests
  // ==========================================================================

  describe('image data handling', () => {
    it('handles tool results with only image data for non-vision models', async () => {
      const imageTool = createMockToolWithResult('screenshot_tool', {
        imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      });

      const { cleanup } = setupMockLLMClient([
        { type: 'tool_call', toolName: 'screenshot_tool', toolArgs: {} },
        { type: 'final_answer', answer: 'Screenshot taken' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createDefaultConfig([imageTool]);
      config.getVisionCapability = async () => false; // Non-vision model
      const hooks = createDefaultHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Take a screenshot')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Take a screenshot' }),
        config,
        hooks,
        null
      );

      assertSuccessResult(result);

      // Find the tool result message
      const toolResult = result.intermediateSteps?.find(
        (m) => m.entity === ChatMessageEntity.TOOL_RESULT && (m as ToolResultMessage).toolName === 'screenshot_tool'
      ) as ToolResultMessage;

      assert.isOk(toolResult);
      // For non-vision models, image-only results should get placeholder text
      assert.strictEqual(toolResult.resultText, 'Image omitted (model lacks vision).');
    });
  });

  // ==========================================================================
  // computeToolResultText Tests
  // ==========================================================================

  describe('computeToolResultText static method', () => {
    it('returns string results as-is', () => {
      const result = AgentRunner.computeToolResultText('Hello world');
      assert.strictEqual(result, 'Hello world');
    });

    it('returns JSON for object results without image', () => {
      const result = AgentRunner.computeToolResultText({ key: 'value', count: 42 });
      const parsed = JSON.parse(result);
      assert.deepStrictEqual(parsed, { key: 'value', count: 42 });
    });

    it('returns placeholder for image-only results', () => {
      const result = AgentRunner.computeToolResultText(
        { imageData: 'base64...' },
        'base64...'
      );
      assert.strictEqual(result, 'Image omitted (model lacks vision).');
    });

    it('includes non-image fields even when image is present', () => {
      const result = AgentRunner.computeToolResultText(
        { imageData: 'base64...', width: 100, height: 200 },
        'base64...'
      );
      const parsed = JSON.parse(result);
      assert.deepStrictEqual(parsed, { width: 100, height: 200 });
    });
  });
});
