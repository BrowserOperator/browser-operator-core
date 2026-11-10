// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { MiniAppEventBus } from '../MiniAppEventBus.js';
import type { MiniAppEvent } from '../types/MiniAppTypes.js';

describe('MiniAppEventBus', () => {
  let eventBus: MiniAppEventBus;

  beforeEach(() => {
    // Get the singleton instance
    eventBus = MiniAppEventBus.getInstance();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('singleton', () => {
    it('returns the same instance', () => {
      const instance1 = MiniAppEventBus.getInstance();
      const instance2 = MiniAppEventBus.getInstance();

      assert.strictEqual(instance1, instance2);
    });
  });

  describe('emit and subscribe', () => {
    it('emits and receives events', () => {
      const callback = sinon.stub();
      const unsubscribe = eventBus.subscribe(callback);

      const event: MiniAppEvent = {
        type: 'app_launched',
        appId: 'test-app',
        timestamp: new Date(),
        data: { webappId: 'webapp-123' },
      };

      eventBus.emit(event);

      sinon.assert.calledOnce(callback);
      sinon.assert.calledWith(callback, event);

      unsubscribe();
    });

    it('unsubscribe stops receiving events', () => {
      const callback = sinon.stub();
      const unsubscribe = eventBus.subscribe(callback);

      eventBus.emit({
        type: 'app_launched',
        appId: 'test-app',
        timestamp: new Date(),
      });

      sinon.assert.calledOnce(callback);

      unsubscribe();

      eventBus.emit({
        type: 'app_closed',
        appId: 'test-app',
        timestamp: new Date(),
      });

      // Should still be called only once (from before unsubscribe)
      sinon.assert.calledOnce(callback);
    });
  });

  describe('subscribeToApp', () => {
    it('filters by app ID', () => {
      const callback = sinon.stub();
      const unsubscribe = eventBus.subscribeToApp('target-app', callback);

      // Event for different app - should not trigger
      eventBus.emit({
        type: 'app_launched',
        appId: 'other-app',
        timestamp: new Date(),
      });

      sinon.assert.notCalled(callback);

      // Event for target app - should trigger
      eventBus.emit({
        type: 'app_launched',
        appId: 'target-app',
        timestamp: new Date(),
      });

      sinon.assert.calledOnce(callback);

      unsubscribe();
    });
  });

  describe('subscribeToType', () => {
    it('filters by event type', () => {
      const callback = sinon.stub();
      const unsubscribe = eventBus.subscribeToType('state_changed', callback);

      // Different event type - should not trigger
      eventBus.emit({
        type: 'app_launched',
        appId: 'test-app',
        timestamp: new Date(),
      });

      sinon.assert.notCalled(callback);

      // Target event type - should trigger
      eventBus.emit({
        type: 'state_changed',
        appId: 'test-app',
        timestamp: new Date(),
        data: { key: 'value' },
      });

      sinon.assert.calledOnce(callback);

      unsubscribe();
    });
  });

  describe('subscribeToAppEvent', () => {
    it('filters by both app ID and event type', () => {
      const callback = sinon.stub();
      const unsubscribe = eventBus.subscribeToAppEvent('target-app', 'state_changed', callback);

      // Different app - should not trigger
      eventBus.emit({
        type: 'state_changed',
        appId: 'other-app',
        timestamp: new Date(),
      });

      // Different event type - should not trigger
      eventBus.emit({
        type: 'app_launched',
        appId: 'target-app',
        timestamp: new Date(),
      });

      sinon.assert.notCalled(callback);

      // Matching app and event type - should trigger
      eventBus.emit({
        type: 'state_changed',
        appId: 'target-app',
        timestamp: new Date(),
        data: { key: 'value' },
      });

      sinon.assert.calledOnce(callback);

      unsubscribe();
    });
  });

  describe('waitForEvent', () => {
    it('resolves on matching event', async () => {
      const promise = eventBus.waitForEvent('test-app', 'app_launched');

      // Emit the event after a small delay
      setTimeout(() => {
        eventBus.emit({
          type: 'app_launched',
          appId: 'test-app',
          timestamp: new Date(),
          data: { webappId: 'webapp-123' },
        });
      }, 10);

      const event = await promise;

      assert.strictEqual(event.type, 'app_launched');
      assert.strictEqual(event.appId, 'test-app');
    });

    it('rejects on timeout', async () => {
      const promise = eventBus.waitForEvent('test-app', 'app_launched', 50);

      try {
        await promise;
        assert.fail('Should have thrown timeout error');
      } catch (error) {
        assert.match((error as Error).message, /Timeout/);
      }
    });

    it('ignores non-matching events', async () => {
      const promise = eventBus.waitForEvent('test-app', 'app_closed', 100);

      // Emit wrong event type
      setTimeout(() => {
        eventBus.emit({
          type: 'app_launched',
          appId: 'test-app',
          timestamp: new Date(),
        });
      }, 10);

      // Emit correct event
      setTimeout(() => {
        eventBus.emit({
          type: 'app_closed',
          appId: 'test-app',
          timestamp: new Date(),
        });
      }, 30);

      const event = await promise;

      assert.strictEqual(event.type, 'app_closed');
    });
  });

  describe('helper emitters', () => {
    it('emitLaunched creates app_launched event', () => {
      const callback = sinon.stub();
      const unsubscribe = eventBus.subscribe(callback);

      eventBus.emitLaunched('test-app', { webappId: 'webapp-123' });

      sinon.assert.calledOnce(callback);
      const event = callback.firstCall.args[0] as MiniAppEvent;
      assert.strictEqual(event.type, 'app_launched');
      assert.strictEqual(event.appId, 'test-app');
      assert.deepEqual(event.data, { webappId: 'webapp-123' });

      unsubscribe();
    });

    it('emitClosed creates app_closed event', () => {
      const callback = sinon.stub();
      const unsubscribe = eventBus.subscribe(callback);

      eventBus.emitClosed('test-app');

      sinon.assert.calledOnce(callback);
      const event = callback.firstCall.args[0] as MiniAppEvent;
      assert.strictEqual(event.type, 'app_closed');
      assert.strictEqual(event.appId, 'test-app');

      unsubscribe();
    });

    it('emitStateChanged creates state_changed event', () => {
      const callback = sinon.stub();
      const unsubscribe = eventBus.subscribe(callback);

      const state = { key1: 'value1', count: 42 };
      eventBus.emitStateChanged('test-app', state);

      sinon.assert.calledOnce(callback);
      const event = callback.firstCall.args[0] as MiniAppEvent;
      assert.strictEqual(event.type, 'state_changed');
      assert.deepEqual(event.data, state);

      unsubscribe();
    });

    it('emitError creates error event with Error object', () => {
      const callback = sinon.stub();
      const unsubscribe = eventBus.subscribe(callback);

      eventBus.emitError('test-app', new Error('Something went wrong'));

      sinon.assert.calledOnce(callback);
      const event = callback.firstCall.args[0] as MiniAppEvent;
      assert.strictEqual(event.type, 'error');
      assert.deepEqual(event.data, { error: 'Something went wrong' });

      unsubscribe();
    });

    it('emitError creates error event with string', () => {
      const callback = sinon.stub();
      const unsubscribe = eventBus.subscribe(callback);

      eventBus.emitError('test-app', 'Error message');

      sinon.assert.calledOnce(callback);
      const event = callback.firstCall.args[0] as MiniAppEvent;
      assert.strictEqual(event.type, 'error');
      assert.deepEqual(event.data, { error: 'Error message' });

      unsubscribe();
    });
  });
});
