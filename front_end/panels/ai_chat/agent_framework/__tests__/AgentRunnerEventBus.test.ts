// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Tests for AgentRunnerEventBus class.
 * Tests singleton behavior, event emission, listener registration,
 * and event data structure validation.
 */

import { AgentRunnerEventBus, type AgentRunnerProgressEvent } from '../AgentRunnerEventBus.js';
import type { EventTargetEvent } from '../../../../core/common/EventTarget.js';

// Type alias for the event bus events map
type EventBusEvents = { 'agent-progress': AgentRunnerProgressEvent };

// ============================================================================
// Tests
// ============================================================================

describe('ai_chat: AgentRunnerEventBus', () => {
  // ==========================================================================
  // Singleton Behavior Tests
  // ==========================================================================

  describe('singleton pattern', () => {
    it('returns same instance on multiple calls', () => {
      const instance1 = AgentRunnerEventBus.getInstance();
      const instance2 = AgentRunnerEventBus.getInstance();

      assert.strictEqual(instance1, instance2);
    });

    it('instance is consistent across test runs', () => {
      const instance = AgentRunnerEventBus.getInstance();
      assert.isOk(instance);
      assert.isFunction(instance.emitProgress);
    });
  });

  // ==========================================================================
  // Event Emission Tests
  // ==========================================================================

  describe('event emission', () => {
    it('emits session_started event', (done) => {
      const eventBus = AgentRunnerEventBus.getInstance();

      const event: AgentRunnerProgressEvent = {
        type: 'session_started',
        sessionId: 'test-session-1',
        agentName: 'test_agent',
        timestamp: new Date(),
        data: { session: { agentName: 'test_agent' } },
      };

      const listener = (e: EventTargetEvent<AgentRunnerProgressEvent, EventBusEvents>): void => {
        const receivedEvent = e.data;
        assert.strictEqual(receivedEvent.type, 'session_started');
        assert.strictEqual(receivedEvent.sessionId, 'test-session-1');
        assert.strictEqual(receivedEvent.agentName, 'test_agent');
        eventBus.removeEventListener('agent-progress', listener);
        done();
      };

      eventBus.addEventListener('agent-progress', listener);
      eventBus.emitProgress(event);
    });

    it('emits tool_started event', (done) => {
      const eventBus = AgentRunnerEventBus.getInstance();

      const event: AgentRunnerProgressEvent = {
        type: 'tool_started',
        sessionId: 'test-session-2',
        agentName: 'test_agent',
        timestamp: new Date(),
        data: {
          session: { agentName: 'test_agent' },
          toolCall: { toolName: 'test_tool', toolArgs: {} },
        },
      };

      const listener = (e: EventTargetEvent<AgentRunnerProgressEvent, EventBusEvents>): void => {
        const receivedEvent = e.data;
        assert.strictEqual(receivedEvent.type, 'tool_started');
        assert.strictEqual(receivedEvent.data.toolCall.toolName, 'test_tool');
        eventBus.removeEventListener('agent-progress', listener);
        done();
      };

      eventBus.addEventListener('agent-progress', listener);
      eventBus.emitProgress(event);
    });

    it('emits tool_completed event', (done) => {
      const eventBus = AgentRunnerEventBus.getInstance();

      const event: AgentRunnerProgressEvent = {
        type: 'tool_completed',
        sessionId: 'test-session-3',
        agentName: 'test_agent',
        timestamp: new Date(),
        data: {
          session: { agentName: 'test_agent' },
          toolResult: { success: true, result: { data: 'result' } },
        },
      };

      const listener = (e: EventTargetEvent<AgentRunnerProgressEvent, EventBusEvents>): void => {
        const receivedEvent = e.data;
        assert.strictEqual(receivedEvent.type, 'tool_completed');
        assert.isTrue(receivedEvent.data.toolResult.success);
        eventBus.removeEventListener('agent-progress', listener);
        done();
      };

      eventBus.addEventListener('agent-progress', listener);
      eventBus.emitProgress(event);
    });

    it('emits session_completed event', (done) => {
      const eventBus = AgentRunnerEventBus.getInstance();

      const event: AgentRunnerProgressEvent = {
        type: 'session_completed',
        sessionId: 'test-session-4',
        agentName: 'test_agent',
        timestamp: new Date(),
        data: {
          session: { agentName: 'test_agent', status: 'completed' },
          reason: 'final_answer',
        },
      };

      const listener = (e: EventTargetEvent<AgentRunnerProgressEvent, EventBusEvents>): void => {
        const receivedEvent = e.data;
        assert.strictEqual(receivedEvent.type, 'session_completed');
        assert.strictEqual(receivedEvent.data.reason, 'final_answer');
        eventBus.removeEventListener('agent-progress', listener);
        done();
      };

      eventBus.addEventListener('agent-progress', listener);
      eventBus.emitProgress(event);
    });

    it('emits child_agent_started event', (done) => {
      const eventBus = AgentRunnerEventBus.getInstance();

      const event: AgentRunnerProgressEvent = {
        type: 'child_agent_started',
        sessionId: 'parent-session',
        parentSessionId: undefined,
        agentName: 'parent_agent',
        timestamp: new Date(),
        data: {
          parentSession: { agentName: 'parent_agent' },
          childAgentName: 'child_agent',
          childSessionId: 'child-session',
        },
      };

      const listener = (e: EventTargetEvent<AgentRunnerProgressEvent, EventBusEvents>): void => {
        const receivedEvent = e.data;
        assert.strictEqual(receivedEvent.type, 'child_agent_started');
        assert.strictEqual(receivedEvent.data.childAgentName, 'child_agent');
        assert.strictEqual(receivedEvent.data.childSessionId, 'child-session');
        eventBus.removeEventListener('agent-progress', listener);
        done();
      };

      eventBus.addEventListener('agent-progress', listener);
      eventBus.emitProgress(event);
    });

    it('emits session_updated event', (done) => {
      const eventBus = AgentRunnerEventBus.getInstance();

      const event: AgentRunnerProgressEvent = {
        type: 'session_updated',
        sessionId: 'test-session-5',
        agentName: 'test_agent',
        timestamp: new Date(),
        data: {
          session: { agentName: 'test_agent', iterationCount: 3 },
        },
      };

      const listener = (e: EventTargetEvent<AgentRunnerProgressEvent, EventBusEvents>): void => {
        const receivedEvent = e.data;
        assert.strictEqual(receivedEvent.type, 'session_updated');
        eventBus.removeEventListener('agent-progress', listener);
        done();
      };

      eventBus.addEventListener('agent-progress', listener);
      eventBus.emitProgress(event);
    });
  });

  // ==========================================================================
  // Event Data Structure Tests
  // ==========================================================================

  describe('event data structure', () => {
    it('includes all required fields', (done) => {
      const eventBus = AgentRunnerEventBus.getInstance();
      const timestamp = new Date();

      const event: AgentRunnerProgressEvent = {
        type: 'session_started',
        sessionId: 'struct-test-session',
        parentSessionId: 'parent-session-id',
        agentName: 'structure_test_agent',
        timestamp,
        data: { test: true },
      };

      const listener = (e: EventTargetEvent<AgentRunnerProgressEvent, EventBusEvents>): void => {
        const receivedEvent = e.data;
        // Verify all fields are present
        assert.isOk(receivedEvent.type);
        assert.isOk(receivedEvent.sessionId);
        assert.isOk(receivedEvent.agentName);
        assert.isOk(receivedEvent.timestamp);
        assert.isOk(receivedEvent.data);

        // Verify optional fields
        assert.strictEqual(receivedEvent.parentSessionId, 'parent-session-id');

        eventBus.removeEventListener('agent-progress', listener);
        done();
      };

      eventBus.addEventListener('agent-progress', listener);
      eventBus.emitProgress(event);
    });

    it('preserves timestamp as Date object', (done) => {
      const eventBus = AgentRunnerEventBus.getInstance();
      const timestamp = new Date('2025-01-15T12:00:00Z');

      const event: AgentRunnerProgressEvent = {
        type: 'session_started',
        sessionId: 'timestamp-test',
        agentName: 'test_agent',
        timestamp,
        data: {},
      };

      const listener = (e: EventTargetEvent<AgentRunnerProgressEvent, EventBusEvents>): void => {
        const receivedEvent = e.data;
        assert.instanceOf(receivedEvent.timestamp, Date);
        assert.strictEqual(receivedEvent.timestamp.toISOString(), timestamp.toISOString());
        eventBus.removeEventListener('agent-progress', listener);
        done();
      };

      eventBus.addEventListener('agent-progress', listener);
      eventBus.emitProgress(event);
    });

    it('preserves complex data objects', (done) => {
      const eventBus = AgentRunnerEventBus.getInstance();

      const complexData = {
        session: {
          agentName: 'complex_agent',
          messages: [
            { id: '1', type: 'tool_call' },
            { id: '2', type: 'tool_result' },
          ],
          nestedSessions: [
            { sessionId: 'nested-1', agentName: 'nested_agent' },
          ],
        },
        toolCall: {
          toolName: 'complex_tool',
          toolArgs: {
            nested: {
              deeply: {
                value: 42,
              },
            },
          },
        },
      };

      const event: AgentRunnerProgressEvent = {
        type: 'tool_started',
        sessionId: 'complex-data-test',
        agentName: 'complex_agent',
        timestamp: new Date(),
        data: complexData,
      };

      const listener = (e: EventTargetEvent<AgentRunnerProgressEvent, EventBusEvents>): void => {
        const receivedEvent = e.data;
        assert.deepStrictEqual(receivedEvent.data, complexData);
        assert.strictEqual(receivedEvent.data.toolCall.toolArgs.nested.deeply.value, 42);
        eventBus.removeEventListener('agent-progress', listener);
        done();
      };

      eventBus.addEventListener('agent-progress', listener);
      eventBus.emitProgress(event);
    });
  });

  // ==========================================================================
  // Multiple Listener Tests
  // ==========================================================================

  describe('multiple listeners', () => {
    it('notifies all registered listeners', (done) => {
      const eventBus = AgentRunnerEventBus.getInstance();
      let listener1Called = false;
      let listener2Called = false;

      const event: AgentRunnerProgressEvent = {
        type: 'session_started',
        sessionId: 'multi-listener-test',
        agentName: 'test_agent',
        timestamp: new Date(),
        data: {},
      };

      const checkComplete = (): void => {
        if (listener1Called && listener2Called) {
          done();
        }
      };

      const listener1 = (e: EventTargetEvent<AgentRunnerProgressEvent, EventBusEvents>): void => {
        listener1Called = true;
        eventBus.removeEventListener('agent-progress', listener1);
        checkComplete();
      };

      const listener2 = (e: EventTargetEvent<AgentRunnerProgressEvent, EventBusEvents>): void => {
        listener2Called = true;
        eventBus.removeEventListener('agent-progress', listener2);
        checkComplete();
      };

      eventBus.addEventListener('agent-progress', listener1);
      eventBus.addEventListener('agent-progress', listener2);
      eventBus.emitProgress(event);
    });

    it('allows removing specific listeners', (done) => {
      const eventBus = AgentRunnerEventBus.getInstance();
      let removedListenerCalled = false;
      let activeListenerCalled = false;

      const event: AgentRunnerProgressEvent = {
        type: 'session_started',
        sessionId: 'remove-listener-test',
        agentName: 'test_agent',
        timestamp: new Date(),
        data: {},
      };

      const removedListener = (): void => {
        removedListenerCalled = true;
      };

      const activeListener = (e: EventTargetEvent<AgentRunnerProgressEvent, EventBusEvents>): void => {
        activeListenerCalled = true;
        eventBus.removeEventListener('agent-progress', activeListener);

        // Give some time for removed listener to potentially be called
        setTimeout(() => {
          assert.isFalse(removedListenerCalled, 'Removed listener should not be called');
          assert.isTrue(activeListenerCalled, 'Active listener should be called');
          done();
        }, 10);
      };

      eventBus.addEventListener('agent-progress', removedListener);
      eventBus.addEventListener('agent-progress', activeListener);

      // Remove the first listener before emitting
      eventBus.removeEventListener('agent-progress', removedListener);

      eventBus.emitProgress(event);
    });
  });

  // ==========================================================================
  // Event Type Validation Tests
  // ==========================================================================

  describe('event types', () => {
    const eventTypes: AgentRunnerProgressEvent['type'][] = [
      'session_started',
      'tool_started',
      'tool_completed',
      'session_updated',
      'child_agent_started',
      'session_completed',
    ];

    eventTypes.forEach((eventType) => {
      it(`handles ${eventType} event type`, (done) => {
        const eventBus = AgentRunnerEventBus.getInstance();

        const event: AgentRunnerProgressEvent = {
          type: eventType,
          sessionId: `${eventType}-test`,
          agentName: 'test_agent',
          timestamp: new Date(),
          data: {},
        };

        const listener = (e: EventTargetEvent<AgentRunnerProgressEvent, EventBusEvents>): void => {
          const receivedEvent = e.data;
          assert.strictEqual(receivedEvent.type, eventType);
          eventBus.removeEventListener('agent-progress', listener);
          done();
        };

        eventBus.addEventListener('agent-progress', listener);
        eventBus.emitProgress(event);
      });
    });
  });
});
