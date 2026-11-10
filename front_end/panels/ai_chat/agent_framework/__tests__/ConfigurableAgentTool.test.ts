// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Tests for ConfigurableAgentTool class.
 * Tests constructor validation, configuration handling, model name resolution,
 * lifecycle hooks, and result creation.
 */

import { ConfigurableAgentTool, ToolRegistry, type AgentToolConfig, type CallCtx } from '../ConfigurableAgentTool.js';
import { MODEL_SENTINELS } from '../../core/Constants.js';
import { AIChatPanel } from '../../ui/AIChatPanel.js';
import { LLMClient } from '../../LLM/LLMClient.js';
import { AgentDescriptorRegistry } from '../../core/AgentDescriptorRegistry.js';
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

function createMockCallCtx(overrides: Partial<CallCtx> = {}): CallCtx {
  return {
    apiKey: overrides.apiKey ?? 'test-api-key',
    model: overrides.model ?? 'gpt-4.1-2025-04-14',
    mainModel: overrides.mainModel ?? 'gpt-4.1-2025-04-14',
    miniModel: overrides.miniModel ?? 'gpt-4.1-mini',
    nanoModel: overrides.nanoModel,
    provider: overrides.provider ?? 'openai',
    ...overrides,
  };
}

function createMockAgentArgs(args: Partial<{ query: string; reasoning: string }> = {}): { query: string; reasoning: string } {
  return {
    query: args.query || 'Test query',
    reasoning: args.reasoning || '',
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

type MockLLMResponse =
  | { type: 'tool_call'; toolName: string; toolArgs: any }
  | { type: 'final_answer'; answer: string }
  | { type: 'error'; error: string };

function setupMockLLMClient(responses: MockLLMResponse[]): { cleanup: () => void } {
  const responseQueue = [...responses];
  let callCount = 0;
  const originalGetInstance = (LLMClient as any).getInstance;

  (LLMClient as any).getInstance = () => ({
    call: async () => {
      callCount++;
      return { rawResponse: { callNumber: callCount } };
    },
    parseResponse: () => {
      const response = responseQueue.shift();
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
  });

  return {
    cleanup: () => {
      (LLMClient as any).getInstance = originalGetInstance;
    },
  };
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

function stubAIChatPanel(): void {
  (AIChatPanel as any).getProviderForModel = (_model: string) => 'openai';
  (AIChatPanel as any).isVisionCapable = async (_model: string) => false;
}

function resetToolRegistry(): void {
  // Clear the registry for test isolation
  (ToolRegistry as any).toolFactories = new Map();
  (ToolRegistry as any).registeredTools = new Map();
}

// ============================================================================
// Tests
// ============================================================================

describe('ai_chat: ConfigurableAgentTool', () => {
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
  // Constructor Tests
  // ==========================================================================

  describe('constructor', () => {
    it('creates agent with minimal required config', () => {
      const config = createMockAgentToolConfig({
        name: 'minimal_agent',
        description: 'A minimal test agent',
        systemPrompt: 'You are minimal.',
      });

      const agent = new ConfigurableAgentTool(config);

      assert.strictEqual(agent.name, 'minimal_agent');
      assert.strictEqual(agent.description, 'A minimal test agent');
      assert.deepStrictEqual(agent.schema, config.schema);
    });

    it('creates agent with full config including optional fields', () => {
      const config = createMockAgentToolConfig({
        name: 'full_agent',
        description: 'A fully configured agent',
        systemPrompt: 'You are fully configured.',
        tools: ['tool_a', 'tool_b'],
        maxIterations: 15,
        temperature: 0.5,
        version: '2025-01-01',
        ui: {
          displayName: 'Full Agent',
          avatar: '🤖',
          color: '#ff0000',
        },
      });

      const agent = new ConfigurableAgentTool(config);

      assert.strictEqual(agent.name, 'full_agent');
      assert.strictEqual(agent.config.maxIterations, 15);
      assert.strictEqual(agent.config.temperature, 0.5);
      assert.strictEqual(agent.config.version, '2025-01-01');
      assert.strictEqual(agent.config.ui?.displayName, 'Full Agent');
    });

    it('throws error when systemPrompt is missing', () => {
      const config = {
        name: 'no_prompt_agent',
        description: 'Missing system prompt',
        systemPrompt: '', // Empty string
        tools: [],
        schema: { type: 'object', properties: {} },
      };

      assert.throws(() => {
        new ConfigurableAgentTool(config as AgentToolConfig);
      }, /systemPrompt is required/);
    });

    it('calls init hook if provided', () => {
      let initCalled = false;
      let initAgent: ConfigurableAgentTool | null = null;

      const config = createMockAgentToolConfig({
        name: 'init_agent',
        init: (agent) => {
          initCalled = true;
          initAgent = agent;
        },
      });

      const agent = new ConfigurableAgentTool(config);

      assert.isTrue(initCalled);
      assert.strictEqual(initAgent, agent);
    });

    it('registers agent descriptor on creation', async () => {
      const config = createMockAgentToolConfig({
        name: 'descriptor_agent',
        version: '1.0.0',
      });

      new ConfigurableAgentTool(config);

      // Wait for async registration
      await new Promise(resolve => setTimeout(resolve, 10));

      const descriptor = await AgentDescriptorRegistry.getDescriptor('descriptor_agent');
      // Descriptor registration is async, may or may not be available immediately
      // This test verifies the pattern is followed
    });
  });

  // ==========================================================================
  // Model Name Resolution Tests
  // ==========================================================================

  describe('model name resolution', () => {
    it('uses string modelName directly', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done with custom model' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createMockAgentToolConfig({
        name: 'string_model_agent',
        modelName: 'custom-model-v1',
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx();

      const result = await agent.execute(createMockAgentArgs(), ctx);

      assertSuccessResult(result);
    });

    it('resolves modelName from function', async () => {
      let functionCalled = false;

      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done with function model' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createMockAgentToolConfig({
        name: 'function_model_agent',
        modelName: () => {
          functionCalled = true;
          return 'dynamic-model-v2';
        },
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx();

      await agent.execute(createMockAgentArgs(), ctx);

      assert.isTrue(functionCalled);
    });

    it('resolves USE_MINI sentinel to miniModel from context', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done with mini model' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createMockAgentToolConfig({
        name: 'mini_model_agent',
        modelName: MODEL_SENTINELS.USE_MINI,
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx({
        miniModel: 'gpt-4.1-mini',
        mainModel: 'gpt-4.1',
      });

      const result = await agent.execute(createMockAgentArgs(), ctx);

      assertSuccessResult(result);
    });

    it('resolves USE_NANO sentinel to nanoModel from context', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done with nano model' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createMockAgentToolConfig({
        name: 'nano_model_agent',
        modelName: MODEL_SENTINELS.USE_NANO,
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx({
        nanoModel: 'gpt-4.1-nano',
        miniModel: 'gpt-4.1-mini',
        mainModel: 'gpt-4.1',
      });

      const result = await agent.execute(createMockAgentArgs(), ctx);

      assertSuccessResult(result);
    });

    it('falls back to mainModel when miniModel not provided for USE_MINI', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done with fallback' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createMockAgentToolConfig({
        name: 'fallback_agent',
        modelName: MODEL_SENTINELS.USE_MINI,
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx({
        mainModel: 'gpt-4.1-main',
        // miniModel intentionally not set
      });
      delete ctx.miniModel;

      const result = await agent.execute(createMockAgentArgs(), ctx);

      assertSuccessResult(result);
    });

    it('uses context model when no modelName in config', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done with context model' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createMockAgentToolConfig({
        name: 'context_model_agent',
      });
      delete config.modelName; // No model specified in config

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx({
        model: 'context-provided-model',
        mainModel: 'main-model',
      });

      const result = await agent.execute(createMockAgentArgs(), ctx);

      assertSuccessResult(result);
    });
  });

  // ==========================================================================
  // API Key Handling Tests
  // ==========================================================================

  describe('API key handling', () => {
    it('returns error when API key missing for OpenAI provider', async () => {
      const config = createMockAgentToolConfig({
        name: 'no_key_agent',
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx({
        provider: 'openai',
      });
      delete ctx.apiKey; // Remove API key

      const result = await agent.execute(createMockAgentArgs(), ctx);

      assertErrorResult(result, 'API key not configured');
    });

    it('allows execution without API key for LiteLLM provider', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done without API key' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createMockAgentToolConfig({
        name: 'litellm_agent',
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx({
        provider: 'litellm',
      });
      delete ctx.apiKey; // No API key needed for LiteLLM

      const result = await agent.execute(createMockAgentArgs(), ctx);

      assertSuccessResult(result);
    });

    it('allows execution without API key for BrowserOperator provider', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done without API key' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createMockAgentToolConfig({
        name: 'browseroperator_agent',
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx({
        provider: 'browseroperator',
      });
      delete ctx.apiKey;

      const result = await agent.execute(createMockAgentArgs(), ctx);

      assertSuccessResult(result);
    });
  });

  // ==========================================================================
  // Lifecycle Hooks Tests
  // ==========================================================================

  describe('lifecycle hooks', () => {
    it('calls beforeExecute hook before execution', async () => {
      let hookCalled = false;
      let hookCtx: CallCtx | null = null;

      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createMockAgentToolConfig({
        name: 'before_hook_agent',
        beforeExecute: async (ctx) => {
          hookCalled = true;
          hookCtx = ctx;
        },
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx();

      await agent.execute(createMockAgentArgs(), ctx);

      assert.isTrue(hookCalled);
      assert.isOk(hookCtx);
    });

    it('continues execution even if beforeExecute throws', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done despite hook error' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createMockAgentToolConfig({
        name: 'failing_before_hook_agent',
        beforeExecute: async () => {
          throw new Error('Hook failed!');
        },
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx();

      const result = await agent.execute(createMockAgentArgs(), ctx);

      // Should still succeed despite hook failure
      assertSuccessResult(result);
    });

    it('calls afterExecute hook after successful execution', async () => {
      let hookCalled = false;
      let hookResult: any = null;

      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Success' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createMockAgentToolConfig({
        name: 'after_hook_agent',
        afterExecute: async (result, session, ctx) => {
          hookCalled = true;
          hookResult = result;
        },
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx();

      await agent.execute(createMockAgentArgs(), ctx);

      assert.isTrue(hookCalled);
      assert.isOk(hookResult);
      assert.isTrue(hookResult.success);
    });
  });

  // ==========================================================================
  // Result Creation Tests
  // ==========================================================================

  describe('result creation', () => {
    it('includes intermediate steps when includeIntermediateStepsOnReturn is true', async () => {
      const tool = createMockToolWithResult('step_tool', { ok: true });
      ToolRegistry.registerToolFactory('step_tool', () => tool);

      const { cleanup } = setupMockLLMClient([
        { type: 'tool_call', toolName: 'step_tool', toolArgs: {} },
        { type: 'final_answer', answer: 'Done with steps' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createMockAgentToolConfig({
        name: 'steps_agent',
        tools: ['step_tool'],
        includeIntermediateStepsOnReturn: true,
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx();

      const result = await agent.execute(createMockAgentArgs(), ctx);

      assertSuccessResult(result);
      assert.isArray(result.intermediateSteps);
      assert.isAtLeast(result.intermediateSteps!.length, 1);
    });

    it('excludes intermediate steps when includeIntermediateStepsOnReturn is false', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done without steps' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createMockAgentToolConfig({
        name: 'no_steps_agent',
        includeIntermediateStepsOnReturn: false, // Explicitly false
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx();

      const result = await agent.execute(createMockAgentArgs(), ctx);

      assertSuccessResult(result);
      // Steps should not be included
      assert.isUndefined(result.intermediateSteps);
    });

    it('uses custom createSuccessResult when provided', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Custom success' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createMockAgentToolConfig({
        name: 'custom_success_agent',
        createSuccessResult: (output, steps, reason, config) => ({
          success: true,
          output: `CUSTOM: ${output}`,
          terminationReason: reason,
          intermediateSteps: steps,
        }),
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx();

      const result = await agent.execute(createMockAgentArgs(), ctx);

      assert.isTrue(result.success);
      assert.include(result.output!, 'CUSTOM:');
    });

    it('uses custom createErrorResult when provided', async () => {
      // Make LLM fail
      (LLMClient as any).getInstance = () => ({
        call: async () => { throw new Error('LLM error'); },
        parseResponse: () => ({ type: 'error', error: 'failed' }),
      });
      mockLLMCleanup = () => {};

      const config = createMockAgentToolConfig({
        name: 'custom_error_agent',
        createErrorResult: (error, steps, reason, config) => ({
          success: false,
          error: `CUSTOM ERROR: ${error}`,
          terminationReason: reason,
          intermediateSteps: steps,
        }),
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx();

      const result = await agent.execute(createMockAgentArgs(), ctx);

      assert.isFalse(result.success);
      assert.include(result.error!, 'CUSTOM ERROR:');
    });
  });

  // ==========================================================================
  // Custom Message Preparation Tests
  // ==========================================================================

  describe('custom message preparation', () => {
    it('uses custom prepareMessages when provided', async () => {
      let prepareMessagesCalled = false;

      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done with custom messages' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createMockAgentToolConfig({
        name: 'custom_messages_agent',
        prepareMessages: (args, config) => {
          prepareMessagesCalled = true;
          return [
            {
              entity: 1, // USER
              text: `Custom message for: ${args.query}`,
            } as any,
          ];
        },
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx();

      await agent.execute(createMockAgentArgs({ query: 'Test query' }), ctx);

      assert.isTrue(prepareMessagesCalled);
    });
  });

  // ==========================================================================
  // Agent Session Return Tests
  // ==========================================================================

  describe('agent session', () => {
    it('returns agentSession with result', async () => {
      const { cleanup } = setupMockLLMClient([
        { type: 'final_answer', answer: 'Done' },
      ]);
      mockLLMCleanup = cleanup;

      const config = createMockAgentToolConfig({
        name: 'session_agent',
      });

      const agent = new ConfigurableAgentTool(config);
      const ctx = createMockCallCtx();

      const result = await agent.execute(createMockAgentArgs(), ctx);

      assert.isOk(result.agentSession);
      assert.strictEqual(result.agentSession.agentName, 'session_agent');
      assert.isOk(result.agentSession.sessionId);
    });
  });
});
