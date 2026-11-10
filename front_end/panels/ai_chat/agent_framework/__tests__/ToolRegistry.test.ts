// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Tests for ToolRegistry class.
 * Tests tool registration, factory management, instance caching,
 * and error handling.
 */

import { ToolRegistry, ConfigurableAgentTool, type AgentToolConfig } from '../ConfigurableAgentTool.js';
import type { Tool } from '../../tools/Tools.js';

// ============================================================================
// Test Helper Functions
// ============================================================================

function createMockTool<TInput = any, TOutput = any>(
  name: string,
  executeFn: (args: TInput) => Promise<TOutput>,
  options?: { schema?: any; description?: string }
): Tool<TInput, TOutput> {
  return {
    name,
    description: options?.description || `Mock tool ${name}`,
    schema: options?.schema || { type: 'object', properties: {} },
    execute: executeFn,
  };
}

function createMockToolWithResult(name: string, result: any): Tool<any, any> {
  return createMockTool(name, async () => result);
}

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

function resetToolRegistry(): void {
  // Clear the registry for test isolation
  (ToolRegistry as any).toolFactories = new Map();
  (ToolRegistry as any).registeredTools = new Map();
}

// ============================================================================
// Tests
// ============================================================================

describe('ai_chat: ToolRegistry', () => {
  beforeEach(() => {
    resetToolRegistry();
  });

  afterEach(() => {
    resetToolRegistry();
  });

  // ==========================================================================
  // Registration Tests
  // ==========================================================================

  describe('registerToolFactory', () => {
    it('registers and retrieves a tool factory', () => {
      const mockTool = createMockToolWithResult('test_tool', { registered: true });

      ToolRegistry.registerToolFactory('test_tool', () => mockTool);

      const instance = ToolRegistry.getToolInstance('test_tool');
      assert.isOk(instance);
      assert.strictEqual(instance?.name, 'test_tool');
    });

    it('registers multiple distinct tools', () => {
      const tool1 = createMockToolWithResult('tool_1', { id: 1 });
      const tool2 = createMockToolWithResult('tool_2', { id: 2 });
      const tool3 = createMockToolWithResult('tool_3', { id: 3 });

      ToolRegistry.registerToolFactory('tool_1', () => tool1);
      ToolRegistry.registerToolFactory('tool_2', () => tool2);
      ToolRegistry.registerToolFactory('tool_3', () => tool3);

      assert.isOk(ToolRegistry.getToolInstance('tool_1'));
      assert.isOk(ToolRegistry.getToolInstance('tool_2'));
      assert.isOk(ToolRegistry.getToolInstance('tool_3'));

      assert.strictEqual(ToolRegistry.getToolInstance('tool_1')?.name, 'tool_1');
      assert.strictEqual(ToolRegistry.getToolInstance('tool_2')?.name, 'tool_2');
      assert.strictEqual(ToolRegistry.getToolInstance('tool_3')?.name, 'tool_3');
    });

    it('overwrites existing factory when registering duplicate', () => {
      const originalTool = createMockToolWithResult('duplicate_tool', { version: 1 });
      const replacementTool = createMockToolWithResult('duplicate_tool', { version: 2 });

      ToolRegistry.registerToolFactory('duplicate_tool', () => originalTool);
      ToolRegistry.registerToolFactory('duplicate_tool', () => replacementTool);

      // Should return the replacement
      const instance = ToolRegistry.getRegisteredTool('duplicate_tool');
      assert.isOk(instance);
    });

    it('creates and caches instance immediately upon registration', () => {
      let factoryCallCount = 0;
      const factory = () => {
        factoryCallCount++;
        return createMockToolWithResult('cached_tool', { call: factoryCallCount });
      };

      // Registration should call factory once
      ToolRegistry.registerToolFactory('cached_tool', factory);
      assert.strictEqual(factoryCallCount, 1);

      // getRegisteredTool should return cached instance (no new factory call)
      ToolRegistry.getRegisteredTool('cached_tool');
      assert.strictEqual(factoryCallCount, 1);
    });

    it('handles factory instantiation error gracefully', () => {
      const failingFactory = () => {
        throw new Error('Factory exploded!');
      };

      // Should not throw, but tool should not be available
      ToolRegistry.registerToolFactory('failing_tool', failingFactory);

      // Tool should not be registered due to instantiation failure
      const instance = ToolRegistry.getRegisteredTool('failing_tool');
      assert.isNull(instance);
    });
  });

  // ==========================================================================
  // Instance Retrieval Tests
  // ==========================================================================

  describe('getToolInstance', () => {
    it('creates new instance on each call', () => {
      let instanceCount = 0;
      const factory = () => {
        instanceCount++;
        return createMockToolWithResult('fresh_tool', { instance: instanceCount });
      };

      ToolRegistry.registerToolFactory('fresh_tool', factory);
      instanceCount = 0; // Reset after registration creates first instance

      // Each call should create new instance
      const instance1 = ToolRegistry.getToolInstance('fresh_tool');
      const instance2 = ToolRegistry.getToolInstance('fresh_tool');
      const instance3 = ToolRegistry.getToolInstance('fresh_tool');

      assert.strictEqual(instanceCount, 3);
    });

    it('returns null for unregistered tool', () => {
      const instance = ToolRegistry.getToolInstance('nonexistent_tool');
      assert.isNull(instance);
    });

    it('returns functional tool instance', async () => {
      const mockTool = createMockTool<{ value: number }, { doubled: number }>(
        'math_tool',
        async (args) => ({ doubled: args.value * 2 })
      );

      ToolRegistry.registerToolFactory('math_tool', () => mockTool);

      const instance = ToolRegistry.getToolInstance('math_tool');
      assert.isOk(instance);

      const result = await instance!.execute({ value: 5 });
      assert.deepStrictEqual(result, { doubled: 10 });
    });
  });

  // ==========================================================================
  // Registered Tool Retrieval Tests
  // ==========================================================================

  describe('getRegisteredTool', () => {
    it('returns cached instance', () => {
      const mockTool = createMockToolWithResult('cached_tool', { cached: true });
      ToolRegistry.registerToolFactory('cached_tool', () => mockTool);

      const instance1 = ToolRegistry.getRegisteredTool('cached_tool');
      const instance2 = ToolRegistry.getRegisteredTool('cached_tool');

      // Should be same instance
      assert.strictEqual(instance1, instance2);
    });

    it('returns null for unregistered tool', () => {
      const instance = ToolRegistry.getRegisteredTool('unregistered_tool');
      assert.isNull(instance);
    });

    it('returns null if factory failed during registration', () => {
      ToolRegistry.registerToolFactory('bad_tool', () => {
        throw new Error('Cannot instantiate');
      });

      const instance = ToolRegistry.getRegisteredTool('bad_tool');
      assert.isNull(instance);
    });
  });

  // ==========================================================================
  // ConfigurableAgentTool Detection Tests
  // ==========================================================================

  describe('ConfigurableAgentTool instances', () => {
    it('can store and retrieve ConfigurableAgentTool as a tool', () => {
      const agentConfig = createMockAgentToolConfig({
        name: 'agent_as_tool',
        description: 'An agent registered as a tool',
        systemPrompt: 'You are an agent tool.',
      });

      ToolRegistry.registerToolFactory('agent_as_tool', () => new ConfigurableAgentTool(agentConfig));

      const instance = ToolRegistry.getRegisteredTool('agent_as_tool');
      assert.isOk(instance);
      assert.instanceOf(instance, ConfigurableAgentTool);
    });

    it('can distinguish ConfigurableAgentTool from regular tools', () => {
      const regularTool = createMockToolWithResult('regular_tool', { type: 'regular' });
      const agentConfig = createMockAgentToolConfig({
        name: 'agent_tool',
        systemPrompt: 'Agent prompt',
      });

      ToolRegistry.registerToolFactory('regular_tool', () => regularTool);
      ToolRegistry.registerToolFactory('agent_tool', () => new ConfigurableAgentTool(agentConfig));

      const regular = ToolRegistry.getRegisteredTool('regular_tool');
      const agent = ToolRegistry.getRegisteredTool('agent_tool');

      assert.notInstanceOf(regular, ConfigurableAgentTool);
      assert.instanceOf(agent, ConfigurableAgentTool);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('handles tool with special characters in name', () => {
      const specialTool = createMockToolWithResult('tool-with-dashes_and_underscores.v2', { special: true });

      ToolRegistry.registerToolFactory('tool-with-dashes_and_underscores.v2', () => specialTool);

      const instance = ToolRegistry.getRegisteredTool('tool-with-dashes_and_underscores.v2');
      assert.isOk(instance);
      assert.strictEqual(instance?.name, 'tool-with-dashes_and_underscores.v2');
    });

    it('handles empty tool name', () => {
      const emptyNameTool = createMockToolWithResult('', { empty: true });

      ToolRegistry.registerToolFactory('', () => emptyNameTool);

      const instance = ToolRegistry.getToolInstance('');
      assert.isOk(instance);
    });

    it('handles tool with complex schema', () => {
      const complexTool = createMockTool('complex_tool', async () => ({}), {
        schema: {
          type: 'object',
          properties: {
            nested: {
              type: 'object',
              properties: {
                value: { type: 'string' },
              },
            },
            array: {
              type: 'array',
              items: { type: 'number' },
            },
          },
          required: ['nested'],
        },
      });

      ToolRegistry.registerToolFactory('complex_tool', () => complexTool);

      const instance = ToolRegistry.getToolInstance('complex_tool');
      assert.isOk(instance);
      assert.isOk(instance?.schema.properties?.nested);
      assert.isOk(instance?.schema.properties?.array);
    });
  });

  // ==========================================================================
  // Isolation Tests
  // ==========================================================================

  describe('test isolation', () => {
    it('registry is clean after reset', () => {
      // Register a tool
      const tool = createMockToolWithResult('isolation_tool', {});
      ToolRegistry.registerToolFactory('isolation_tool', () => tool);

      // Verify it's registered
      assert.isOk(ToolRegistry.getRegisteredTool('isolation_tool'));

      // Reset
      resetToolRegistry();

      // Should no longer exist
      assert.isNull(ToolRegistry.getRegisteredTool('isolation_tool'));
      assert.isNull(ToolRegistry.getToolInstance('isolation_tool'));
    });
  });
});
