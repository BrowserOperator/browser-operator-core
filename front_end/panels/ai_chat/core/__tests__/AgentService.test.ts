// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Tests for AgentService class.
 * Tests singleton pattern, execution tracking, event handling,
 * and state management.
 */

import { AgentService, Events } from '../AgentService.js';

// ============================================================================
// Test Helper Functions
// ============================================================================

function resetAgentServiceInstance(): void {
  // Clear the singleton instance for test isolation
  (AgentService as any).instance = undefined;
}

function clearActiveExecutions(): void {
  // Clear active executions tracking
  (AgentService as any).activeExecutions = new Map();
}

// ============================================================================
// Tests
// ============================================================================

describe('ai_chat: AgentService', () => {
  beforeEach(() => {
    resetAgentServiceInstance();
    clearActiveExecutions();
  });

  afterEach(() => {
    clearActiveExecutions();
  });

  // ==========================================================================
  // Singleton Pattern Tests
  // ==========================================================================

  describe('singleton pattern', () => {
    it('returns same instance on multiple calls', () => {
      const instance1 = AgentService.getInstance();
      const instance2 = AgentService.getInstance();

      assert.strictEqual(instance1, instance2);
    });

    it('instance is persistent across test calls', () => {
      const instance = AgentService.getInstance();
      assert.isOk(instance);
      assert.isFunction(instance.getMessages);
    });
  });

  // ==========================================================================
  // Execution Tracking Tests
  // ==========================================================================

  describe('execution tracking', () => {
    it('registers and retrieves execution controller', () => {
      const controller = new AbortController();
      const executionId = 'test-execution-1';

      AgentService.registerExecution(executionId, controller);

      const retrieved = AgentService.getExecutionController(executionId);
      assert.strictEqual(retrieved, controller);
    });

    it('returns undefined for unregistered execution', () => {
      const retrieved = AgentService.getExecutionController('nonexistent');
      assert.isUndefined(retrieved);
    });

    it('unregisters execution correctly', () => {
      const controller = new AbortController();
      const executionId = 'test-execution-2';

      AgentService.registerExecution(executionId, controller);
      assert.isOk(AgentService.getExecutionController(executionId));

      AgentService.unregisterExecution(executionId);
      assert.isUndefined(AgentService.getExecutionController(executionId));
    });

    it('aborts all active executions', () => {
      const controller1 = new AbortController();
      const controller2 = new AbortController();
      const controller3 = new AbortController();

      AgentService.registerExecution('exec-1', controller1);
      AgentService.registerExecution('exec-2', controller2);
      AgentService.registerExecution('exec-3', controller3);

      assert.isFalse(controller1.signal.aborted);
      assert.isFalse(controller2.signal.aborted);
      assert.isFalse(controller3.signal.aborted);

      AgentService.abortAllExecutions();

      assert.isTrue(controller1.signal.aborted);
      assert.isTrue(controller2.signal.aborted);
      assert.isTrue(controller3.signal.aborted);

      // Should clear all executions
      assert.isUndefined(AgentService.getExecutionController('exec-1'));
      assert.isUndefined(AgentService.getExecutionController('exec-2'));
      assert.isUndefined(AgentService.getExecutionController('exec-3'));
    });

    it('handles aborting empty execution list gracefully', () => {
      // Should not throw
      assert.doesNotThrow(() => AgentService.abortAllExecutions());
    });

    it('registers multiple executions with unique IDs', () => {
      const controllers = [
        new AbortController(),
        new AbortController(),
        new AbortController(),
      ];

      controllers.forEach((ctrl, i) => {
        AgentService.registerExecution(`multi-${i}`, ctrl);
      });

      controllers.forEach((ctrl, i) => {
        assert.strictEqual(AgentService.getExecutionController(`multi-${i}`), ctrl);
      });
    });

    it('overwrites existing execution with same ID', () => {
      const controller1 = new AbortController();
      const controller2 = new AbortController();
      const executionId = 'same-id';

      AgentService.registerExecution(executionId, controller1);
      AgentService.registerExecution(executionId, controller2);

      const retrieved = AgentService.getExecutionController(executionId);
      assert.strictEqual(retrieved, controller2);
    });
  });

  // ==========================================================================
  // Running State Tests
  // ==========================================================================

  describe('running state', () => {
    it('isRunning returns false when not executing', () => {
      const service = AgentService.getInstance();
      assert.isFalse(service.isRunning());
    });

    it('isInitialized returns false initially', () => {
      const service = AgentService.getInstance();
      // After reset, should not be initialized (depends on API key)
      // In Node environment without browser deps, this is expected
      assert.isFalse(service.isInitialized());
    });
  });

  // ==========================================================================
  // API Key Management Tests
  // ==========================================================================

  describe('API key management', () => {
    it('getApiKey returns null initially', () => {
      const service = AgentService.getInstance();
      // In a fresh instance, API key should be null
      assert.isNull(service.getApiKey());
    });

    it('setApiKey updates the API key and marks for reinitialization', () => {
      const service = AgentService.getInstance();

      // First set it to something
      service.setApiKey('test-key-123');
      assert.strictEqual(service.getApiKey(), 'test-key-123');

      // isInitialized should be false after setApiKey (forces re-init)
      assert.isFalse(service.isInitialized());
    });
  });

  // ==========================================================================
  // State Management Tests
  // ==========================================================================

  describe('state management', () => {
    it('getState returns current state', () => {
      const service = AgentService.getInstance();
      const state = service.getState();

      assert.isOk(state);
      assert.isArray(state.messages);
    });

    it('getMessages returns messages array', () => {
      const service = AgentService.getInstance();
      const messages = service.getMessages();

      assert.isArray(messages);
      // Should have at least the welcome message
      assert.isAtLeast(messages.length, 1);
    });

    it('initial message is welcome message', () => {
      const service = AgentService.getInstance();
      const messages = service.getMessages();

      const firstMessage = messages[0];
      assert.isOk(firstMessage);
      // Welcome message should be from MODEL entity
      assert.strictEqual(firstMessage.entity, 'model');
    });
  });

  // ==========================================================================
  // Event System Tests
  // ==========================================================================

  describe('event system', () => {
    it('can add event listener', () => {
      const service = AgentService.getInstance();
      let eventReceived = false;

      const listener = (): void => {
        eventReceived = true;
      };

      // Should not throw
      assert.doesNotThrow(() => {
        service.addEventListener(Events.MESSAGES_CHANGED, listener as any);
      });

      // Clean up
      service.removeEventListener(Events.MESSAGES_CHANGED, listener as any);
    });

    it('dispatches events to listeners', (done) => {
      const service = AgentService.getInstance();
      const testMessages = [{ entity: 'user' as const, text: 'test' }];

      const listener = (event: { data: any }): void => {
        assert.isArray(event.data);
        service.removeEventListener(Events.MESSAGES_CHANGED, listener as any);
        done();
      };

      service.addEventListener(Events.MESSAGES_CHANGED, listener as any);
      (service as any).dispatchEventToListeners(Events.MESSAGES_CHANGED, testMessages);
    });

    it('removes event listener correctly', () => {
      const service = AgentService.getInstance();
      let callCount = 0;

      const listener = (): void => {
        callCount++;
      };

      service.addEventListener(Events.MESSAGES_CHANGED, listener as any);

      // Dispatch first event
      (service as any).dispatchEventToListeners(Events.MESSAGES_CHANGED, []);
      assert.strictEqual(callCount, 1);

      // Remove listener
      service.removeEventListener(Events.MESSAGES_CHANGED, listener as any);

      // Dispatch second event - should not increment
      (service as any).dispatchEventToListeners(Events.MESSAGES_CHANGED, []);
      assert.strictEqual(callCount, 1);
    });

    it('supports multiple listeners for same event', () => {
      const service = AgentService.getInstance();
      let count1 = 0;
      let count2 = 0;

      const listener1 = (): void => { count1++; };
      const listener2 = (): void => { count2++; };

      service.addEventListener(Events.MESSAGES_CHANGED, listener1 as any);
      service.addEventListener(Events.MESSAGES_CHANGED, listener2 as any);

      (service as any).dispatchEventToListeners(Events.MESSAGES_CHANGED, []);

      assert.strictEqual(count1, 1);
      assert.strictEqual(count2, 1);

      // Clean up
      service.removeEventListener(Events.MESSAGES_CHANGED, listener1 as any);
      service.removeEventListener(Events.MESSAGES_CHANGED, listener2 as any);
    });
  });

  // ==========================================================================
  // Agent Sessions Tests
  // ==========================================================================

  describe('agent sessions', () => {
    it('getActiveAgentSessions returns empty array initially', () => {
      const service = AgentService.getInstance();
      const sessions = service.getActiveAgentSessions();

      assert.isArray(sessions);
      assert.strictEqual(sessions.length, 0);
    });
  });

  // ==========================================================================
  // Conversation Management Tests
  // ==========================================================================

  describe('conversation management', () => {
    it('getCurrentConversationId returns null initially', () => {
      const service = AgentService.getInstance();
      assert.isNull(service.getCurrentConversationId());
    });

    it('getCurrentConversationTitle returns default for empty conversation', () => {
      const service = AgentService.getInstance();
      const title = service.getCurrentConversationTitle();
      // Should return "New Chat" or similar default
      assert.isString(title);
    });
  });

  // ==========================================================================
  // Events Enum Tests
  // ==========================================================================

  describe('Events enum', () => {
    it('defines all expected event types', () => {
      assert.strictEqual(Events.MESSAGES_CHANGED, 'messages-changed');
      assert.strictEqual(Events.AGENT_SESSION_STARTED, 'agent-session-started');
      assert.strictEqual(Events.AGENT_TOOL_STARTED, 'agent-tool-started');
      assert.strictEqual(Events.AGENT_TOOL_COMPLETED, 'agent-tool-completed');
      assert.strictEqual(Events.AGENT_SESSION_UPDATED, 'agent-session-updated');
      assert.strictEqual(Events.AGENT_SESSION_COMPLETED, 'agent-session-completed');
      assert.strictEqual(Events.CHILD_AGENT_STARTED, 'child-agent-started');
      assert.strictEqual(Events.CONVERSATION_CHANGED, 'conversation-changed');
      assert.strictEqual(Events.CONVERSATION_SAVED, 'conversation-saved');
    });
  });

  // ==========================================================================
  // Cancel and Clear Tests
  // ==========================================================================

  describe('cancel and clear operations', () => {
    it('cancelRun does not throw when nothing is running', () => {
      const service = AgentService.getInstance();
      assert.doesNotThrow(() => service.cancelRun());
    });

    it('clearConversation resets to welcome message', async () => {
      const service = AgentService.getInstance();

      // Clear conversation
      service.clearConversation();

      // Wait a tick for async operations
      await new Promise(resolve => setTimeout(resolve, 10));

      const messages = service.getMessages();
      // Should have welcome message
      assert.isAtLeast(messages.length, 1);
    });

    it('resetInitialization clears initialization state', () => {
      const service = AgentService.getInstance();

      service.resetInitialization();

      assert.isFalse(service.isInitialized());
      assert.isNull(service.getApiKey());
    });
  });
});
