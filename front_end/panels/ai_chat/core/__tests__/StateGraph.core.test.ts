// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Tests for StateGraph class.
 * Tests graph construction, execution flow, conditional routing,
 * state management, abort handling, and safety limits.
 */

import { StateGraph, END_NODE_MARKER } from '../StateGraph.js';
import type { Runnable } from '../Types.js';
import { ChatMessageEntity, type ChatMessage, type ModelChatMessage } from '../../models/ChatTypes.js';

// ============================================================================
// Test Helper Functions
// ============================================================================

function createTestAbortController(): { controller: AbortController; signal: AbortSignal } {
  const controller = new AbortController();
  return { controller, signal: controller.signal };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Test Types
// ============================================================================

interface TestState {
  messages: ChatMessage[];
  value: number;
  path: string[];
  context?: {
    tracingContext?: any;
  };
}

// ============================================================================
// Test Node Factories
// ============================================================================

function createTestNode(
  name: string,
  transform: (state: TestState) => TestState
): Runnable<TestState, TestState> {
  return {
    invoke: async (state: TestState, signal?: AbortSignal): Promise<TestState> => {
      // Track the path through nodes
      const newState = { ...state, path: [...state.path, name] };
      return transform(newState);
    },
  };
}

function createDelayNode(
  name: string,
  delayMs: number
): Runnable<TestState, TestState> {
  return {
    invoke: async (state: TestState, signal?: AbortSignal): Promise<TestState> => {
      await delay(delayMs);
      return { ...state, path: [...state.path, name] };
    },
  };
}

function createErrorNode(name: string, errorMessage: string): Runnable<TestState, TestState> {
  return {
    invoke: async (state: TestState, signal?: AbortSignal): Promise<TestState> => {
      throw new Error(errorMessage);
    },
  };
}

function createCounterNode(name: string): Runnable<TestState, TestState> {
  return {
    invoke: async (state: TestState, signal?: AbortSignal): Promise<TestState> => {
      return {
        ...state,
        value: state.value + 1,
        path: [...state.path, name],
      };
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ai_chat: StateGraph', () => {
  // ==========================================================================
  // Graph Construction Tests
  // ==========================================================================

  describe('graph construction', () => {
    it('creates a graph with a name', () => {
      const graph = new StateGraph<TestState>({ name: 'test_graph' });
      assert.isOk(graph);
    });

    it('adds nodes successfully', () => {
      const graph = new StateGraph<TestState>({ name: 'add_nodes_graph' });
      const node1 = createTestNode('node1', (s) => s);
      const node2 = createTestNode('node2', (s) => s);

      // Should not throw
      graph.addNode('node1', node1);
      graph.addNode('node2', node2);
    });

    it('sets entry point correctly', () => {
      const graph = new StateGraph<TestState>({ name: 'entry_point_graph' });
      const startNode = createTestNode('start', (s) => s);

      graph.addNode('start', startNode);
      graph.setEntryPoint('start');

      // Should not throw
      const compiled = graph.compile();
      assert.isOk(compiled);
    });

    it('throws error when setting entry point to unknown node', () => {
      const graph = new StateGraph<TestState>({ name: 'unknown_entry_graph' });

      assert.throws(() => {
        graph.setEntryPoint('nonexistent_node');
      }, /not found/);
    });

    it('adds conditional edges', () => {
      const graph = new StateGraph<TestState>({ name: 'conditional_graph' });
      const node1 = createTestNode('node1', (s) => s);
      const node2 = createTestNode('node2', (s) => s);
      const node3 = createTestNode('node3', (s) => s);

      graph.addNode('node1', node1);
      graph.addNode('node2', node2);
      graph.addNode('node3', node3);

      // Should not throw
      graph.addConditionalEdges('node1', (state) => state.value > 5 ? 'high' : 'low', {
        high: 'node2',
        low: 'node3',
      });
    });

    it('compiles and returns self', () => {
      const graph = new StateGraph<TestState>({ name: 'compile_graph' });
      const node = createTestNode('start', (s) => s);
      graph.addNode('start', node);
      graph.setEntryPoint('start');

      const compiled = graph.compile();
      assert.strictEqual(compiled, graph);
    });
  });

  // ==========================================================================
  // Basic Execution Tests
  // ==========================================================================

  describe('basic execution', () => {
    it('executes single node and terminates', async () => {
      const graph = new StateGraph<TestState>({ name: 'single_node_graph' });
      const node = createTestNode('only_node', (s) => ({ ...s, value: 42 }));

      graph.addNode('only_node', node);
      graph.setEntryPoint('only_node');

      const initialState: TestState = { messages: [], value: 0, path: [] };

      let finalState: TestState | null = null;
      for await (const state of graph.invoke(initialState)) {
        finalState = state;
      }

      assert.isOk(finalState);
      assert.strictEqual(finalState!.value, 42);
      assert.deepStrictEqual(finalState!.path, ['only_node']);
    });

    it('executes linear sequence of nodes', async () => {
      const graph = new StateGraph<TestState>({ name: 'linear_graph' });

      graph.addNode('step1', createCounterNode('step1'));
      graph.addNode('step2', createCounterNode('step2'));
      graph.addNode('step3', createCounterNode('step3'));

      graph.setEntryPoint('step1');
      graph.addConditionalEdges('step1', () => 'next', { next: 'step2' });
      graph.addConditionalEdges('step2', () => 'next', { next: 'step3' });
      graph.addConditionalEdges('step3', () => 'end', { end: END_NODE_MARKER });

      const initialState: TestState = { messages: [], value: 0, path: [] };

      let finalState: TestState | null = null;
      for await (const state of graph.invoke(initialState)) {
        finalState = state;
      }

      assert.isOk(finalState);
      assert.strictEqual(finalState!.value, 3);
      assert.deepStrictEqual(finalState!.path, ['step1', 'step2', 'step3']);
    });

    it('terminates at END_NODE_MARKER', async () => {
      const graph = new StateGraph<TestState>({ name: 'end_marker_graph' });

      graph.addNode('start', createTestNode('start', (s) => s));
      graph.setEntryPoint('start');
      graph.addConditionalEdges('start', () => 'stop', { stop: END_NODE_MARKER });

      const initialState: TestState = { messages: [], value: 0, path: [] };

      let yieldCount = 0;
      for await (const state of graph.invoke(initialState)) {
        yieldCount++;
      }

      // Should yield once for the start node
      assert.strictEqual(yieldCount, 1);
    });
  });

  // ==========================================================================
  // Conditional Routing Tests
  // ==========================================================================

  describe('conditional routing', () => {
    it('routes based on state value', async () => {
      const graph = new StateGraph<TestState>({ name: 'routing_graph' });

      graph.addNode('decision', createTestNode('decision', (s) => s));
      graph.addNode('path_a', createTestNode('path_a', (s) => ({ ...s, value: s.value + 100 })));
      graph.addNode('path_b', createTestNode('path_b', (s) => ({ ...s, value: s.value + 200 })));

      graph.setEntryPoint('decision');
      graph.addConditionalEdges('decision', (state) => state.value > 5 ? 'a' : 'b', {
        a: 'path_a',
        b: 'path_b',
      });
      graph.addConditionalEdges('path_a', () => 'end', { end: END_NODE_MARKER });
      graph.addConditionalEdges('path_b', () => 'end', { end: END_NODE_MARKER });

      // Test path A (value > 5)
      const stateA: TestState = { messages: [], value: 10, path: [] };
      let finalA: TestState | null = null;
      for await (const state of graph.invoke(stateA)) {
        finalA = state;
      }
      assert.strictEqual(finalA!.value, 110);
      assert.deepStrictEqual(finalA!.path, ['decision', 'path_a']);

      // Test path B (value <= 5)
      const stateB: TestState = { messages: [], value: 3, path: [] };
      let finalB: TestState | null = null;
      for await (const state of graph.invoke(stateB)) {
        finalB = state;
      }
      assert.strictEqual(finalB!.value, 203);
      assert.deepStrictEqual(finalB!.path, ['decision', 'path_b']);
    });

    it('handles unknown routing key gracefully', async () => {
      const graph = new StateGraph<TestState>({ name: 'unknown_route_graph' });

      graph.addNode('start', createTestNode('start', (s) => s));
      graph.setEntryPoint('start');
      graph.addConditionalEdges('start', () => 'unknown_key', {
        known_key: 'start', // Only this key is mapped
      });

      const initialState: TestState = { messages: [], value: 0, path: [] };

      // Should terminate gracefully when routing key doesn't match
      let finalState: TestState | null = null;
      for await (const state of graph.invoke(initialState)) {
        finalState = state;
      }

      assert.isOk(finalState);
      assert.deepStrictEqual(finalState!.path, ['start']);
    });
  });

  // ==========================================================================
  // Generator Behavior Tests
  // ==========================================================================

  describe('generator behavior', () => {
    it('yields intermediate states', async () => {
      const graph = new StateGraph<TestState>({ name: 'yield_graph' });

      graph.addNode('step1', createCounterNode('step1'));
      graph.addNode('step2', createCounterNode('step2'));
      graph.addNode('step3', createCounterNode('step3'));

      graph.setEntryPoint('step1');
      graph.addConditionalEdges('step1', () => 'next', { next: 'step2' });
      graph.addConditionalEdges('step2', () => 'next', { next: 'step3' });
      graph.addConditionalEdges('step3', () => 'end', { end: END_NODE_MARKER });

      const initialState: TestState = { messages: [], value: 0, path: [] };
      const yieldedStates: TestState[] = [];

      for await (const state of graph.invoke(initialState)) {
        yieldedStates.push(state);
      }

      assert.strictEqual(yieldedStates.length, 3);
      assert.strictEqual(yieldedStates[0].value, 1);
      assert.strictEqual(yieldedStates[1].value, 2);
      assert.strictEqual(yieldedStates[2].value, 3);
    });

    it('returns final state from generator', async () => {
      const graph = new StateGraph<TestState>({ name: 'return_graph' });

      graph.addNode('start', createTestNode('start', (s) => ({ ...s, value: 999 })));
      graph.setEntryPoint('start');

      const initialState: TestState = { messages: [], value: 0, path: [] };
      const generator = graph.invoke(initialState);

      // Consume the generator
      let result;
      while (true) {
        const { value, done } = await generator.next();
        if (done) {
          result = value;
          break;
        }
      }

      assert.isOk(result);
      assert.strictEqual(result.value, 999);
    });
  });

  // ==========================================================================
  // Safety Limit Tests
  // ==========================================================================

  describe('safety limits', () => {
    it('respects 50-step safety limit', async () => {
      const graph = new StateGraph<TestState>({ name: 'infinite_graph' });

      // Create an infinite loop
      graph.addNode('loop', createCounterNode('loop'));
      graph.setEntryPoint('loop');
      graph.addConditionalEdges('loop', () => 'continue', { continue: 'loop' });

      const initialState: TestState = { messages: [], value: 0, path: [] };

      let stepCount = 0;
      for await (const state of graph.invoke(initialState)) {
        stepCount++;
      }

      // Should stop at 50 steps (safety limit)
      assert.isAtMost(stepCount, 51); // 50 + potential final step
    });
  });

  // ==========================================================================
  // Abort Signal Tests
  // ==========================================================================

  describe('abort signal handling', () => {
    it('handles abort signal at step boundary', async () => {
      const graph = new StateGraph<TestState>({ name: 'abort_graph' });
      const { controller, signal } = createTestAbortController();

      // Create nodes with delay to allow abort
      graph.addNode('step1', createDelayNode('step1', 10));
      graph.addNode('step2', createDelayNode('step2', 10));
      graph.addNode('step3', createDelayNode('step3', 10));

      graph.setEntryPoint('step1');
      graph.addConditionalEdges('step1', () => 'next', { next: 'step2' });
      graph.addConditionalEdges('step2', () => 'next', { next: 'step3' });
      graph.addConditionalEdges('step3', () => 'end', { end: END_NODE_MARKER });

      const initialState: TestState = { messages: [], value: 0, path: [] };

      // Start execution
      const generator = graph.invoke(initialState, signal);

      // Execute first step
      await generator.next();

      // Abort
      controller.abort();

      // Try to continue - should throw
      let abortError: Error | null = null;
      try {
        await generator.next();
      } catch (error) {
        abortError = error as Error;
      }

      assert.isOk(abortError);
      assert.include(abortError!.message.toLowerCase(), 'abort');
    });

    it('handles pre-aborted signal', async () => {
      const graph = new StateGraph<TestState>({ name: 'pre_abort_graph' });
      const { controller, signal } = createTestAbortController();
      controller.abort(); // Pre-abort

      graph.addNode('start', createTestNode('start', (s) => s));
      graph.setEntryPoint('start');

      const initialState: TestState = { messages: [], value: 0, path: [] };

      let abortError: Error | null = null;
      try {
        for await (const state of graph.invoke(initialState, signal)) {
          // Should not reach here
        }
      } catch (error) {
        abortError = error as Error;
      }

      assert.isOk(abortError);
      assert.include(abortError!.message.toLowerCase(), 'abort');
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('error handling', () => {
    it('propagates node execution errors', async () => {
      const graph = new StateGraph<TestState>({ name: 'error_graph' });

      graph.addNode('error_node', createErrorNode('error_node', 'Node exploded!'));
      graph.setEntryPoint('error_node');

      const initialState: TestState = { messages: [], value: 0, path: [] };

      let finalState: TestState | null = null;
      for await (const state of graph.invoke(initialState)) {
        finalState = state;
      }

      // Graph should add error message to state
      assert.isOk(finalState);
      const errorMessage = finalState!.messages.find(
        (m) => m.entity === ChatMessageEntity.MODEL && (m as ModelChatMessage).error
      ) as ModelChatMessage | undefined;

      assert.isOk(errorMessage);
      assert.include(errorMessage!.error!, 'Node exploded!');
    });

    it('terminates execution after error', async () => {
      const graph = new StateGraph<TestState>({ name: 'terminate_error_graph' });

      graph.addNode('before', createCounterNode('before'));
      graph.addNode('error', createErrorNode('error', 'Boom!'));
      graph.addNode('after', createCounterNode('after'));

      graph.setEntryPoint('before');
      graph.addConditionalEdges('before', () => 'next', { next: 'error' });
      graph.addConditionalEdges('error', () => 'next', { next: 'after' });

      const initialState: TestState = { messages: [], value: 0, path: [] };

      let finalState: TestState | null = null;
      for await (const state of graph.invoke(initialState)) {
        finalState = state;
      }

      // Should have executed 'before' but not 'after'
      assert.include(finalState!.path, 'before');
      assert.notInclude(finalState!.path, 'after');
    });
  });

  // ==========================================================================
  // State Management Tests
  // ==========================================================================

  describe('state management', () => {
    it('passes state between nodes', async () => {
      const graph = new StateGraph<TestState>({ name: 'state_pass_graph' });

      graph.addNode('set_value', createTestNode('set_value', (s) => ({ ...s, value: 100 })));
      graph.addNode('double_value', createTestNode('double_value', (s) => ({ ...s, value: s.value * 2 })));
      graph.addNode('add_ten', createTestNode('add_ten', (s) => ({ ...s, value: s.value + 10 })));

      graph.setEntryPoint('set_value');
      graph.addConditionalEdges('set_value', () => 'next', { next: 'double_value' });
      graph.addConditionalEdges('double_value', () => 'next', { next: 'add_ten' });
      graph.addConditionalEdges('add_ten', () => 'end', { end: END_NODE_MARKER });

      const initialState: TestState = { messages: [], value: 0, path: [] };

      let finalState: TestState | null = null;
      for await (const state of graph.invoke(initialState)) {
        finalState = state;
      }

      // 0 -> 100 -> 200 -> 210
      assert.strictEqual(finalState!.value, 210);
    });

    it('accumulates message history', async () => {
      const graph = new StateGraph<TestState>({ name: 'messages_graph' });

      graph.addNode('add_msg_1', createTestNode('add_msg_1', (s) => ({
        ...s,
        messages: [...s.messages, { entity: ChatMessageEntity.USER, text: 'Message 1' } as ChatMessage],
      })));
      graph.addNode('add_msg_2', createTestNode('add_msg_2', (s) => ({
        ...s,
        messages: [...s.messages, { entity: ChatMessageEntity.USER, text: 'Message 2' } as ChatMessage],
      })));

      graph.setEntryPoint('add_msg_1');
      graph.addConditionalEdges('add_msg_1', () => 'next', { next: 'add_msg_2' });
      graph.addConditionalEdges('add_msg_2', () => 'end', { end: END_NODE_MARKER });

      const initialState: TestState = { messages: [], value: 0, path: [] };

      let finalState: TestState | null = null;
      for await (const state of graph.invoke(initialState)) {
        finalState = state;
      }

      assert.strictEqual(finalState!.messages.length, 2);
    });

    it('maintains context through execution', async () => {
      const graph = new StateGraph<TestState>({ name: 'context_graph' });

      graph.addNode('check_context', createTestNode('check_context', (s) => {
        // Verify context is accessible
        if (s.context?.tracingContext?.traceId) {
          return { ...s, value: 1 };
        }
        return { ...s, value: 0 };
      }));

      graph.setEntryPoint('check_context');

      const initialState: TestState = {
        messages: [],
        value: 0,
        path: [],
        context: {
          tracingContext: {
            traceId: 'test-trace-id',
          },
        },
      };

      let finalState: TestState | null = null;
      for await (const state of graph.invoke(initialState)) {
        finalState = state;
      }

      // Context should have been accessible
      assert.strictEqual(finalState!.value, 1);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('handles node with no outgoing edges', async () => {
      const graph = new StateGraph<TestState>({ name: 'no_edges_graph' });

      graph.addNode('lonely_node', createTestNode('lonely_node', (s) => s));
      graph.setEntryPoint('lonely_node');
      // No conditional edges added

      const initialState: TestState = { messages: [], value: 0, path: [] };

      let finalState: TestState | null = null;
      for await (const state of graph.invoke(initialState)) {
        finalState = state;
      }

      // Should execute the node and then terminate
      assert.isOk(finalState);
      assert.deepStrictEqual(finalState!.path, ['lonely_node']);
    });

    it('handles conditional edge to nonexistent node', async () => {
      const graph = new StateGraph<TestState>({ name: 'nonexistent_target_graph' });

      graph.addNode('start', createTestNode('start', (s) => s));
      graph.setEntryPoint('start');
      graph.addConditionalEdges('start', () => 'go', { go: 'nonexistent' });

      const initialState: TestState = { messages: [], value: 0, path: [] };

      // Should terminate gracefully
      let finalState: TestState | null = null;
      for await (const state of graph.invoke(initialState)) {
        finalState = state;
      }

      assert.isOk(finalState);
    });
  });
});
