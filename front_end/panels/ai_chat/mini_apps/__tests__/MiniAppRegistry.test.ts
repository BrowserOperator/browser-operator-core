// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { MiniAppRegistry } from '../MiniAppRegistry.js';
import { MiniAppEventBus } from '../MiniAppEventBus.js';
import { RenderWebAppTool } from '../../tools/RenderWebAppTool.js';
import { RemoveWebAppTool } from '../../tools/RemoveWebAppTool.js';
import { GenericMiniAppBridge } from '../GenericMiniAppBridge.js';
import type {
  MiniApp,
  MiniAppController,
  MiniAppActionSchema,
  MiniAppStateSchema,
} from '../types/MiniAppTypes.js';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockController(overrides?: Partial<MiniAppController>): MiniAppController {
  return {
    initialize: sinon.stub().resolves(),
    getState: sinon.stub().resolves({ testKey: 'testValue' }),
    setState: sinon.stub().resolves(),
    updateState: sinon.stub().resolves(),
    executeAction: sinon.stub().resolves({ result: 'action-result' }),
    cleanup: sinon.stub().resolves(),
    onClose: sinon.stub(),
    ...overrides,
  };
}

function createMockMiniApp(id: string, overrides?: Partial<MiniApp>): MiniApp {
  const supportedActions: MiniAppActionSchema[] = [
    {
      name: 'test-action',
      description: 'A test action',
      schema: { type: 'object', properties: {} },
    },
  ];

  const stateSchema: MiniAppStateSchema = {
    type: 'object',
    properties: {
      testKey: { type: 'string', description: 'A test key' },
    },
  };

  return {
    id,
    name: `Test App ${id}`,
    description: `Test mini app ${id}`,
    icon: '🧪',
    getSPA: () => ({ html: '<div>test</div>', css: '.test {}', js: 'console.log("test");' }),
    getSupportedActions: () => supportedActions,
    getStateSchema: () => stateSchema,
    createController: () => createMockController(),
    ...overrides,
  };
}

// ============================================================================
// Test Utilities
// ============================================================================

function resetRegistry(): void {
  // Access private static fields to reset state between tests
  (MiniAppRegistry as any).apps = new Map();
  (MiniAppRegistry as any).instances = new Map();
}

// ============================================================================
// MiniAppRegistry Tests
// ============================================================================

describe('MiniAppRegistry', () => {
  beforeEach(() => {
    resetRegistry();
  });

  afterEach(() => {
    sinon.restore();
    resetRegistry();
  });

  describe('register and getApp', () => {
    it('registers and retrieves mini app definitions', () => {
      const app = createMockMiniApp('test-app');

      MiniAppRegistry.register(app);

      const retrieved = MiniAppRegistry.getApp('test-app');
      assert.isDefined(retrieved);
      assert.strictEqual(retrieved?.id, 'test-app');
      assert.strictEqual(retrieved?.name, 'Test App test-app');
    });

    it('returns undefined for unregistered app', () => {
      const retrieved = MiniAppRegistry.getApp('non-existent');
      assert.isUndefined(retrieved);
    });

    it('replaces existing app when re-registering with same id', () => {
      const app1 = createMockMiniApp('test-app', { name: 'First App' });
      const app2 = createMockMiniApp('test-app', { name: 'Second App' });

      MiniAppRegistry.register(app1);
      MiniAppRegistry.register(app2);

      const retrieved = MiniAppRegistry.getApp('test-app');
      assert.strictEqual(retrieved?.name, 'Second App');
    });
  });

  describe('getAllApps', () => {
    it('returns all registered apps', () => {
      MiniAppRegistry.register(createMockMiniApp('app1'));
      MiniAppRegistry.register(createMockMiniApp('app2'));
      MiniAppRegistry.register(createMockMiniApp('app3'));

      const apps = MiniAppRegistry.getAllApps();
      assert.strictEqual(apps.length, 3);
    });

    it('returns empty array when no apps registered', () => {
      const apps = MiniAppRegistry.getAllApps();
      assert.deepEqual(apps, []);
    });
  });

  describe('launch', () => {
    let renderToolStub: sinon.SinonStub;
    let bridgeInstallStub: sinon.SinonStub;
    let eventBusEmitStub: sinon.SinonStub;

    beforeEach(() => {
      // Mock RenderWebAppTool
      renderToolStub = sinon.stub(RenderWebAppTool.prototype, 'execute').resolves({
        success: true,
        webappId: 'webapp-123',
        message: 'Rendered',
      });

      // Mock GenericMiniAppBridge
      bridgeInstallStub = sinon.stub(GenericMiniAppBridge.prototype, 'install').resolves();

      // Mock EventBus
      const mockEventBus = {
        emit: sinon.stub(),
      };
      eventBusEmitStub = mockEventBus.emit;
      sinon.stub(MiniAppEventBus, 'getInstance').returns(mockEventBus as any);
    });

    it('launches app with full lifecycle (bridge + controller init)', async () => {
      const controller = createMockController();
      const app = createMockMiniApp('test-app', {
        createController: () => controller,
      });
      MiniAppRegistry.register(app);

      const instance = await MiniAppRegistry.launch('test-app');

      assert.strictEqual(instance.app.id, 'test-app');
      assert.strictEqual(instance.webappId, 'webapp-123');
      assert.isDefined(instance.launchedAt);
      sinon.assert.calledOnce(renderToolStub);
      sinon.assert.calledOnce(bridgeInstallStub);
      sinon.assert.calledOnce(controller.initialize as sinon.SinonStub);
      sinon.assert.calledOnce(controller.onClose as sinon.SinonStub);
    });

    it('enforces single instance per app type', async () => {
      const app = createMockMiniApp('test-app');
      MiniAppRegistry.register(app);

      const instance1 = await MiniAppRegistry.launch('test-app');
      const instance2 = await MiniAppRegistry.launch('test-app');

      assert.strictEqual(instance1, instance2);
      // RenderWebAppTool should only be called once
      sinon.assert.calledOnce(renderToolStub);
    });

    it('emits app_launched event on launch', async () => {
      const app = createMockMiniApp('test-app');
      MiniAppRegistry.register(app);

      await MiniAppRegistry.launch('test-app');

      sinon.assert.calledOnce(eventBusEmitStub);
      const emittedEvent = eventBusEmitStub.firstCall.args[0];
      assert.strictEqual(emittedEvent.type, 'app_launched');
      assert.strictEqual(emittedEvent.appId, 'test-app');
    });

    it('throws error when app not registered', async () => {
      try {
        await MiniAppRegistry.launch('unknown-app');
        assert.fail('Should have thrown');
      } catch (error) {
        assert.match((error as Error).message, /not registered/);
      }
    });

    it('wraps SPA JavaScript with mini app protocol', async () => {
      const app = createMockMiniApp('test-app');
      MiniAppRegistry.register(app);

      await MiniAppRegistry.launch('test-app');

      const renderCall = renderToolStub.firstCall.args[0];
      assert.include(renderCall.js, 'window.miniApp');
      assert.include(renderCall.js, '__miniAppBridge_test-app');
      assert.include(renderCall.js, 'dispatch');
      assert.include(renderCall.js, 'getState');
    });
  });

  describe('close', () => {
    let renderToolStub: sinon.SinonStub;
    let removeToolStub: sinon.SinonStub;
    let bridgeUninstallStub: sinon.SinonStub;
    let eventBusEmitStub: sinon.SinonStub;

    beforeEach(() => {
      renderToolStub = sinon.stub(RenderWebAppTool.prototype, 'execute').resolves({
        success: true,
        webappId: 'webapp-123',
        message: 'Rendered',
      });

      removeToolStub = sinon.stub(RemoveWebAppTool.prototype, 'execute').resolves({
        success: true,
        removed: ['webapp-123'],
        message: 'Removed',
      });

      bridgeUninstallStub = sinon.stub(GenericMiniAppBridge.prototype, 'uninstall').resolves();
      sinon.stub(GenericMiniAppBridge.prototype, 'install').resolves();

      const mockEventBus = {
        emit: sinon.stub(),
      };
      eventBusEmitStub = mockEventBus.emit;
      sinon.stub(MiniAppEventBus, 'getInstance').returns(mockEventBus as any);
    });

    it('closes app with proper cleanup', async () => {
      const controller = createMockController();
      const app = createMockMiniApp('test-app', {
        createController: () => controller,
      });
      MiniAppRegistry.register(app);

      await MiniAppRegistry.launch('test-app');
      await MiniAppRegistry.close('test-app');

      sinon.assert.calledOnce(controller.cleanup as sinon.SinonStub);
      sinon.assert.calledOnce(bridgeUninstallStub);
      sinon.assert.calledOnce(removeToolStub);
      assert.isFalse(MiniAppRegistry.isRunning('test-app'));
    });

    it('emits app_closed event on close', async () => {
      const app = createMockMiniApp('test-app');
      MiniAppRegistry.register(app);

      await MiniAppRegistry.launch('test-app');
      eventBusEmitStub.resetHistory();
      await MiniAppRegistry.close('test-app');

      sinon.assert.calledOnce(eventBusEmitStub);
      const emittedEvent = eventBusEmitStub.firstCall.args[0];
      assert.strictEqual(emittedEvent.type, 'app_closed');
      assert.strictEqual(emittedEvent.appId, 'test-app');
    });

    it('handles close of non-running app gracefully', async () => {
      // Should not throw
      await MiniAppRegistry.close('non-running');
      assert.isFalse(MiniAppRegistry.isRunning('non-running'));
    });
  });

  describe('isRunning and getRunningInstance', () => {
    beforeEach(() => {
      sinon.stub(RenderWebAppTool.prototype, 'execute').resolves({
        success: true,
        webappId: 'webapp-123',
        message: 'Rendered',
      });
      sinon.stub(GenericMiniAppBridge.prototype, 'install').resolves();
      sinon.stub(MiniAppEventBus, 'getInstance').returns({ emit: sinon.stub() } as any);
    });

    it('correctly reports running status', async () => {
      const app = createMockMiniApp('test-app');
      MiniAppRegistry.register(app);

      assert.isFalse(MiniAppRegistry.isRunning('test-app'));

      await MiniAppRegistry.launch('test-app');

      assert.isTrue(MiniAppRegistry.isRunning('test-app'));
    });

    it('returns running instance', async () => {
      const app = createMockMiniApp('test-app');
      MiniAppRegistry.register(app);

      assert.isUndefined(MiniAppRegistry.getRunningInstance('test-app'));

      await MiniAppRegistry.launch('test-app');

      const instance = MiniAppRegistry.getRunningInstance('test-app');
      assert.isDefined(instance);
      assert.strictEqual(instance?.app.id, 'test-app');
    });
  });
});
