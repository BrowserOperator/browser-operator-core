// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as SDK from '../../../../core/sdk/sdk.js';
import { createTarget, stubNoopSettings } from '../../../../testing/EnvironmentHelpers.js';
import { describeWithMockConnection, setMockConnectionResponseHandler } from '../../../../testing/MockConnection.js';

import { GenericMiniAppBridge } from '../GenericMiniAppBridge.js';
import type { DevToolsToSPAAction } from '../types/MiniAppTypes.js';

describe('GenericMiniAppBridge', () => {
  describeWithMockConnection('bridge operations', () => {
    let target: SDK.Target.Target;

    beforeEach(() => {
      stubNoopSettings();
      target = createTarget();
    });

    describe('install', () => {
      it('installs binding via Runtime.addBinding', async () => {
        let addBindingCalled = false;
        let bindingName = '';

        setMockConnectionResponseHandler('Runtime.addBinding', (params) => {
          addBindingCalled = true;
          bindingName = params.name || '';
          return {};
        });

        const bridge = new GenericMiniAppBridge('test-app');
        await bridge.install('webapp-123');

        assert.isTrue(addBindingCalled);
        assert.strictEqual(bindingName, '__miniAppBridge_test-app');
        assert.isTrue(bridge.installed);
        assert.strictEqual(bridge.webappId, 'webapp-123');
      });

      it('skips installation if already installed', async () => {
        let addBindingCallCount = 0;

        setMockConnectionResponseHandler('Runtime.addBinding', () => {
          addBindingCallCount++;
          return {};
        });

        const bridge = new GenericMiniAppBridge('test-app');
        await bridge.install('webapp-123');
        await bridge.install('webapp-456'); // Second call should be no-op

        assert.strictEqual(addBindingCallCount, 1);
        assert.strictEqual(bridge.webappId, 'webapp-123'); // Original webappId preserved
      });
    });

    describe('uninstall', () => {
      it('uninstalls cleanly on close', async () => {
        let removeBindingCalled = false;
        let removedBindingName = '';

        setMockConnectionResponseHandler('Runtime.addBinding', () => ({}));
        setMockConnectionResponseHandler('Runtime.removeBinding', (params) => {
          removeBindingCalled = true;
          removedBindingName = params.name || '';
          return {};
        });

        const bridge = new GenericMiniAppBridge('test-app');
        await bridge.install('webapp-123');
        await bridge.uninstall();

        assert.isTrue(removeBindingCalled);
        assert.strictEqual(removedBindingName, '__miniAppBridge_test-app');
        assert.isFalse(bridge.installed);
        assert.isNull(bridge.webappId);
      });

      it('handles uninstall when not installed', async () => {
        const bridge = new GenericMiniAppBridge('test-app');

        // Should not throw
        await bridge.uninstall();

        assert.isFalse(bridge.installed);
      });
    });

    describe('sendToSPA', () => {
      it('sends actions to SPA via Runtime.evaluate', async () => {
        let evaluatedExpression = '';

        setMockConnectionResponseHandler('Runtime.addBinding', () => ({}));
        setMockConnectionResponseHandler('Runtime.evaluate', (params) => {
          evaluatedExpression = params.expression || '';
          return {
            result: { type: 'boolean', value: true },
          };
        });

        const bridge = new GenericMiniAppBridge('test-app');
        await bridge.install('webapp-123');

        const action: DevToolsToSPAAction = {
          action: 'set-state',
          payload: { key: 'value' },
        };
        await bridge.sendToSPA(action);

        assert.include(evaluatedExpression, 'webapp-123');
        assert.include(evaluatedExpression, 'miniApp.dispatch');
        assert.include(evaluatedExpression, 'set-state');
      });

      it('handles send when not installed', async () => {
        const bridge = new GenericMiniAppBridge('test-app');

        // Should not throw, just log error
        await bridge.sendToSPA({ action: 'test' });

        assert.isFalse(bridge.installed);
      });
    });

    describe('getState', () => {
      it('retrieves state from SPA via Runtime.evaluate', async () => {
        const mockState = { key1: 'value1', count: 42 };

        setMockConnectionResponseHandler('Runtime.addBinding', () => ({}));
        setMockConnectionResponseHandler('Runtime.evaluate', () => ({
          result: {
            type: 'object',
            value: mockState,
          },
        }));

        const bridge = new GenericMiniAppBridge('test-app');
        await bridge.install('webapp-123');

        const state = await bridge.getState();

        assert.deepEqual(state, mockState);
      });

      it('returns empty object when not installed', async () => {
        const bridge = new GenericMiniAppBridge('test-app');

        const state = await bridge.getState();

        assert.deepEqual(state, {});
      });

      it('handles evaluation errors gracefully', async () => {
        setMockConnectionResponseHandler('Runtime.addBinding', () => ({}));
        setMockConnectionResponseHandler('Runtime.evaluate', () => ({
          result: { type: 'undefined' },
          exceptionDetails: {
            text: 'Evaluation failed',
            lineNumber: 0,
            columnNumber: 0,
          },
        }));

        const bridge = new GenericMiniAppBridge('test-app');
        await bridge.install('webapp-123');

        const state = await bridge.getState();

        assert.deepEqual(state, {});
      });
    });

    describe('onAction', () => {
      it('registers action handler for SPA actions', async () => {
        setMockConnectionResponseHandler('Runtime.addBinding', () => ({}));

        const bridge = new GenericMiniAppBridge('test-app');
        const actionHandler = sinon.stub();

        bridge.onAction(actionHandler);
        await bridge.install('webapp-123');

        // The handler is registered but we can't easily simulate
        // BindingCalled events in tests without more complex mocking
        // This test verifies the handler can be set without error
        assert.isTrue(bridge.installed);
      });
    });

    describe('properties', () => {
      it('reports correct installed state', async () => {
        setMockConnectionResponseHandler('Runtime.addBinding', () => ({}));
        setMockConnectionResponseHandler('Runtime.removeBinding', () => ({}));

        const bridge = new GenericMiniAppBridge('test-app');

        assert.isFalse(bridge.installed);

        await bridge.install('webapp-123');
        assert.isTrue(bridge.installed);

        await bridge.uninstall();
        assert.isFalse(bridge.installed);
      });

      it('tracks webappId correctly', async () => {
        setMockConnectionResponseHandler('Runtime.addBinding', () => ({}));
        setMockConnectionResponseHandler('Runtime.removeBinding', () => ({}));

        const bridge = new GenericMiniAppBridge('test-app');

        assert.isNull(bridge.webappId);

        await bridge.install('webapp-123');
        assert.strictEqual(bridge.webappId, 'webapp-123');

        await bridge.uninstall();
        assert.isNull(bridge.webappId);
      });
    });
  });
});
