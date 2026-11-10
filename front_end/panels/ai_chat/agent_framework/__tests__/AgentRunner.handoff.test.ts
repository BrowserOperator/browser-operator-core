// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Tests for AgentRunner handoff functionality.
 * Tests LLM-triggered handoffs, max_iterations handoffs,
 * message filtering, nested sessions, and error handling.
 */

import { AgentRunner } from '../AgentRunner.js';
import type { AgentRunnerConfig, AgentRunnerHooks } from '../AgentRunner.js';
import { ConfigurableAgentTool, ToolRegistry, type AgentToolConfig } from '../ConfigurableAgentTool.js';
import { ChatMessageEntity, type ChatMessage } from '../../models/ChatTypes.js';
import { AIChatPanel } from '../../ui/AIChatPanel.js';
import { LLMClient } from '../../LLM/LLMClient.js';
import type { Tool } from '../../tools/Tools.js';

// ============================================================================
// Test Helper Functions
// ============================================================================

function createMockAgentToolConfig(overrides: Partial<AgentToolConfig> = {}): AgentToolConfig {
  return {
    name: overrides.name || 'test_agent',
    description: overrides.description || 'Test agent for unit tests',
    systemPrompt: overrides.systemPrompt || 'You are a test agent.',
    tools: overrides.tools || [],
    schema: overrides.schema || {
      type: 'object',
      properties: {
        query: { type: 'string' },
        reasoning: { type: 'string' },
      },
      required: ['query'],
    },
    maxIterations: overrides.maxIterations || 10,
    temperature: overrides.temperature || 0,
    ...overrides,
  };
}

function createMockAgentRunnerConfig(overrides: Partial<AgentRunnerConfig> = {}): AgentRunnerConfig {
  return {
    apiKey: overrides.apiKey ?? 'test-api-key',
    modelName: overrides.modelName ?? 'gpt-4.1-2025-04-14',
    systemPrompt: overrides.systemPrompt ?? 'You are a helpful assistant.',
    tools: overrides.tools ?? [],
    maxIterations: overrides.maxIterations ?? 10,
    temperature: overrides.temperature ?? 0,
    provider: overrides.provider ?? 'openai',
    ...overrides,
  };
}

function createMockAgentRunnerHooks(): AgentRunnerHooks {
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

function createUserMessage(text: string): ChatMessage {
  return {
    entity: ChatMessageEntity.USER,
    text,
    id: `test-msg-${Date.now()}`,
    timestamp: new Date(),
  } as ChatMessage;
}

function createMockAgentArgs(args: Partial<{ query: string; reasoning: string }> = {}): { query: string; reasoning: string } {
  return {
    query: args.query || 'Test query',
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

function stubAIChatPanel(): void {
  (AIChatPanel as any).getProviderForModel = (_model: string) => 'openai';
  (AIChatPanel as any).isVisionCapable = async (_model: string) => false;
}

function resetToolRegistry(): void {
  (ToolRegistry as any).toolFactories = new Map();
  (ToolRegistry as any).registeredTools = new Map();
}

function createAndRegisterAgent(config: AgentToolConfig): ConfigurableAgentTool {
  const agent = new ConfigurableAgentTool(config);
  ToolRegistry.registerToolFactory(config.name, () => agent);
  return agent;
}

// ============================================================================
// Tests
// ============================================================================

describe('ai_chat: AgentRunner.handoff', () => {
  let mockLLMCleanup: (() => void) | null = null;

  beforeEach(() => {
    stubAIChatPanel();
    resetToolRegistry();
  });

  afterEach(() => {
    if (mockLLMCleanup) {
      mockLLMCleanup();
      mockLLMCleanup = null;
    }
    resetToolRegistry();
  });

  // ==========================================================================
  // LLM-Triggered Handoff Tests
  // ==========================================================================

  describe('LLM-triggered handoffs', () => {
    it('executes handoff when LLM calls handoff tool', async () => {
      // 1. Create and register target agent
      const targetConfig = createMockAgentToolConfig({
        name: 'target_agent',
        description: 'Target agent for handoff',
        systemPrompt: 'You are the target agent.',
      });
      createAndRegisterAgent(targetConfig);

      // 2. Create parent agent with handoff config pointing to target
      const parentConfig = createMockAgentToolConfig({
        name: 'parent_agent',
        description: 'Parent agent that can handoff',
        systemPrompt: 'You are the parent agent.',
        handoffs: [
          {
            targetAgentName: 'target_agent',
            trigger: 'llm_tool_call',
          },
        ],
      });
      const parentAgent = createAndRegisterAgent(parentConfig);

      // 3. Mock LLM with inline pattern that works:
      // - Parent's first call returns handoff tool call
      // - Target's call returns final answer
      let callCount = 0;
      (LLMClient as any).getInstance = () => ({
        call: async () => {
          callCount++;
          if (callCount === 1) {
            // Parent calls handoff
            return {
              rawResponse: {
                choices: [{
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                      id: 'call_1',
                      type: 'function',
                      function: {
                        name: 'handoff_to_target_agent',
                        arguments: JSON.stringify({ query: 'Continue task', reasoning: 'Need specialized help' }),
                      },
                    }],
                  },
                  finish_reason: 'tool_calls',
                }],
              },
            };
          }
          // Target returns final answer
          return {
            rawResponse: {
              choices: [{
                message: { role: 'assistant', content: 'Target completed the task!' },
                finish_reason: 'stop',
              }],
            },
          };
        },
        parseResponse: (response: any) => {
          const message = response.rawResponse?.choices?.[0]?.message;
          if (message?.tool_calls) {
            const toolCall = message.tool_calls[0];
            return {
              type: 'tool_call',
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments),
            };
          }
          return { type: 'final_answer', answer: message?.content || '' };
        },
      });
      mockLLMCleanup = () => {};

      const config = createMockAgentRunnerConfig();
      const hooks = createMockAgentRunnerHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Start task')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Start task' }),
        config,
        hooks,
        parentAgent
      );

      assertSuccessResult(result);
      assertTerminationReason(result, 'handed_off');
    });

    it('continues without handoff tool when target does not exist', async () => {
      // When handoff target doesn't exist, AgentRunner:
      // 1. Logs a warning: "Configured LLM handoff target 'nonexistent_agent' not found"
      // 2. Does NOT add the handoff_to_nonexistent_agent tool to toolSchemas
      // 3. Agent continues normally without the handoff option

      // Create parent agent with handoff to nonexistent target
      const parentConfig = createMockAgentToolConfig({
        name: 'parent_with_bad_handoff',
        systemPrompt: 'Parent agent',
        handoffs: [
          {
            targetAgentName: 'nonexistent_agent',
            trigger: 'llm_tool_call',
          },
        ],
      });
      const parentAgent = createAndRegisterAgent(parentConfig);

      // Since handoff tool won't be available, LLM just returns final answer
      const client = new MockLLMClient();
      client.queueResponse({ type: 'final_answer', answer: 'Completed without handoff' });
      mockLLMCleanup = client.install();

      const config = createMockAgentRunnerConfig();
      const hooks = createMockAgentRunnerHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Do something')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Do something' }),
        config,
        hooks,
        parentAgent
      );

      // Should succeed normally (handoff tool was never available to LLM)
      assertSuccessResult(result);
      assertTerminationReason(result, 'final_answer');
    });
  });

  // ==========================================================================
  // Max Iterations Handoff Tests
  // ==========================================================================

  describe('max_iterations handoffs', () => {
    it('executes handoff when max iterations reached', async () => {
      // 1. Register target agent (continuation_agent) for max_iterations handoff
      const targetConfig = createMockAgentToolConfig({
        name: 'continuation_agent',
        description: 'Continues work after max iterations',
        systemPrompt: 'You continue work.',
      });
      createAndRegisterAgent(targetConfig);
      ToolRegistry.getRegisteredTool('continuation_agent'); // Ensure cached

      // 2. Create parent with max_iterations handoff trigger
      const parentConfig = createMockAgentToolConfig({
        name: 'limited_agent',
        systemPrompt: 'Limited iteration agent',
        maxIterations: 2,
        tools: ['do_work'],
        handoffs: [
          {
            targetAgentName: 'continuation_agent',
            trigger: 'max_iterations',
          },
        ],
      });
      const parentAgent = createAndRegisterAgent(parentConfig);

      // 3. Register a tool for the parent to use
      const workTool = createMockToolWithResult('do_work', { worked: true });
      ToolRegistry.registerToolFactory('do_work', () => workTool);

      // 4. Mock LLM:
      // - Parent's first 2 calls: call do_work tool (will hit max_iterations)
      // - After handoff, target's call: return final answer
      const client = new MockLLMClient();
      // Parent iteration 1
      client.queueResponse({ type: 'tool_call', toolName: 'do_work', toolArgs: {} });
      // Parent iteration 2 - after this, max_iterations is reached, handoff triggers
      client.queueResponse({ type: 'tool_call', toolName: 'do_work', toolArgs: {} });
      // Target (continuation_agent) returns final answer
      client.queueResponse({ type: 'final_answer', answer: 'Work continued and completed!' });
      mockLLMCleanup = client.install();

      const runnerConfig = createMockAgentRunnerConfig({ tools: [workTool], maxIterations: 2 });
      const hooks = createMockAgentRunnerHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Do lots of work')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Do lots of work' }),
        runnerConfig,
        hooks,
        parentAgent
      );

      // Should succeed via handoff
      assertSuccessResult(result);
      assertTerminationReason(result, 'handed_off');
    });

    it('returns max_iterations error when no handoff configured', async () => {
      // Create agent without max_iterations handoff
      const config = createMockAgentToolConfig({
        name: 'no_handoff_agent',
        systemPrompt: 'No handoff configured',
        maxIterations: 2,
        // No handoffs configured
      });
      const agent = createAndRegisterAgent(config);

      const tool = createMockToolWithResult('loop_tool', { looped: true });
      ToolRegistry.registerToolFactory('loop_tool', () => tool);

      // Mock LLM to keep calling tool forever
      const client = new MockLLMClient();
      client.setDefaultResponse({ type: 'tool_call', toolName: 'loop_tool', toolArgs: {} });
      mockLLMCleanup = client.install();

      const runnerConfig = createMockAgentRunnerConfig({ tools: [tool], maxIterations: 2 });
      const hooks = createMockAgentRunnerHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Loop forever')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Loop forever' }),
        runnerConfig,
        hooks,
        agent
      );

      assertErrorResult(result, 'maximum iterations');
      assertTerminationReason(result, 'max_iterations');
    });
  });

  // ==========================================================================
  // Message Filtering Tests
  // ==========================================================================

  describe('message filtering', () => {
    it('filters messages based on includeToolResults', async () => {
      // This test verifies that when includeToolResults is specified,
      // only those tool results are passed to the target agent

      // Create target agent
      const targetConfig = createMockAgentToolConfig({
        name: 'filtered_target',
        systemPrompt: 'Target with filtered messages',
      });
      createAndRegisterAgent(targetConfig);

      // Create parent with filtered handoff
      const parentConfig = createMockAgentToolConfig({
        name: 'filtering_parent',
        systemPrompt: 'Parent that filters',
        tools: ['tool_a', 'tool_b'],
        handoffs: [
          {
            targetAgentName: 'filtered_target',
            trigger: 'llm_tool_call',
            includeToolResults: ['tool_a'], // Only include results from tool_a
          },
        ],
      });
      const parentAgent = createAndRegisterAgent(parentConfig);

      // Register tools
      const toolA = createMockToolWithResult('tool_a', { from: 'a' });
      const toolB = createMockToolWithResult('tool_b', { from: 'b' });
      ToolRegistry.registerToolFactory('tool_a', () => toolA);
      ToolRegistry.registerToolFactory('tool_b', () => toolB);

      // Mock LLM sequence: call tool_a, call tool_b, then handoff
      let callCount = 0;
      (LLMClient as any).getInstance = () => ({
        call: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              rawResponse: {
                choices: [{
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'tool_a', arguments: '{}' },
                    }],
                  },
                  finish_reason: 'tool_calls',
                }],
              },
            };
          }
          if (callCount === 2) {
            return {
              rawResponse: {
                choices: [{
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                      id: 'call_2',
                      type: 'function',
                      function: { name: 'tool_b', arguments: '{}' },
                    }],
                  },
                  finish_reason: 'tool_calls',
                }],
              },
            };
          }
          if (callCount === 3) {
            // Call handoff
            return {
              rawResponse: {
                choices: [{
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                      id: 'call_3',
                      type: 'function',
                      function: {
                        name: 'handoff_to_filtered_target',
                        arguments: JSON.stringify({ query: 'Continue', reasoning: 'Done' }),
                      },
                    }],
                  },
                  finish_reason: 'tool_calls',
                }],
              },
            };
          }
          // Target returns final
          return {
            rawResponse: {
              choices: [{
                message: { role: 'assistant', content: 'Filtered target done!' },
                finish_reason: 'stop',
              }],
            },
          };
        },
        parseResponse: (response: any) => {
          const message = response.rawResponse?.choices?.[0]?.message;
          if (message?.tool_calls) {
            const toolCall = message.tool_calls[0];
            return {
              type: 'tool_call',
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments),
            };
          }
          return { type: 'final_answer', answer: message?.content || '' };
        },
      });
      mockLLMCleanup = () => {};

      const runnerConfig = createMockAgentRunnerConfig({ tools: [toolA, toolB], maxIterations: 10 });
      const hooks = createMockAgentRunnerHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Use both tools then handoff')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Use both tools then handoff' }),
        runnerConfig,
        hooks,
        parentAgent
      );

      assertSuccessResult(result);
    });
  });

  // ==========================================================================
  // Nested Session Tests
  // ==========================================================================

  describe('nested sessions', () => {
    it('creates nested session for handoff target', async () => {
      // Create target agent
      const targetConfig = createMockAgentToolConfig({
        name: 'nested_target',
        systemPrompt: 'Nested target',
      });
      createAndRegisterAgent(targetConfig);

      // Create parent with handoff
      const parentConfig = createMockAgentToolConfig({
        name: 'nesting_parent',
        systemPrompt: 'Parent that nests',
        handoffs: [
          {
            targetAgentName: 'nested_target',
            trigger: 'llm_tool_call',
          },
        ],
      });
      const parentAgent = createAndRegisterAgent(parentConfig);

      // Mock LLM
      let callCount = 0;
      (LLMClient as any).getInstance = () => ({
        call: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              rawResponse: {
                choices: [{
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                      id: 'call_1',
                      type: 'function',
                      function: {
                        name: 'handoff_to_nested_target',
                        arguments: JSON.stringify({ query: 'Nested', reasoning: 'Nesting' }),
                      },
                    }],
                  },
                  finish_reason: 'tool_calls',
                }],
              },
            };
          }
          return {
            rawResponse: {
              choices: [{
                message: { role: 'assistant', content: 'Nested done!' },
                finish_reason: 'stop',
              }],
            },
          };
        },
        parseResponse: (response: any) => {
          const message = response.rawResponse?.choices?.[0]?.message;
          if (message?.tool_calls) {
            const toolCall = message.tool_calls[0];
            return {
              type: 'tool_call',
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments),
            };
          }
          return { type: 'final_answer', answer: message?.content || '' };
        },
      });
      mockLLMCleanup = () => {};

      const runnerConfig = createMockAgentRunnerConfig();
      const hooks = createMockAgentRunnerHooks();
      const initialMessages: ChatMessage[] = [createUserMessage('Nest please')];

      const result = await AgentRunner.run(
        initialMessages,
        createMockAgentArgs({ query: 'Nest please' }),
        runnerConfig,
        hooks,
        parentAgent
      );

      assertSuccessResult(result);

      // Check that session has nested sessions
      const parentSession = result.agentSession;
      assert.isOk(parentSession);
      // The nested session should be present
      assert.isAtLeast(parentSession.nestedSessions.length, 1);
    });
  });
});
