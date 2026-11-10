// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { ListMiniAppsTool } from '../ListMiniAppsTool.js';
import { LaunchMiniAppTool } from '../LaunchMiniAppTool.js';
import { GetMiniAppStateTool } from '../GetMiniAppStateTool.js';
import { UpdateMiniAppStateTool } from '../UpdateMiniAppStateTool.js';
import { ExecuteMiniAppActionTool } from '../ExecuteMiniAppActionTool.js';
import { CloseMiniAppTool } from '../CloseMiniAppTool.js';
import { MiniAppRegistry } from '../../../mini_apps/MiniAppRegistry.js';
import type {
  MiniApp,
  MiniAppController,
  MiniAppBridge,
  MiniAppInstance,
  MiniAppActionSchema,
  MiniAppStateSchema,
} from '../../../mini_apps/types/MiniAppTypes.js';

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

function createMockBridge(webappId: string): MiniAppBridge {
  return {
    install: sinon.stub().resolves(),
    uninstall: sinon.stub().resolves(),
    sendToSPA: sinon.stub().resolves(),
    onAction: sinon.stub(),
    getState: sinon.stub().resolves({}),
    installed: true,
    webappId,
  };
}

function createMockMiniApp(id: string, overrides?: Partial<MiniApp>): MiniApp {
  const supportedActions: MiniAppActionSchema[] = [
    {
      name: 'test-action',
      description: 'A test action',
      schema: { type: 'object', properties: { arg1: { type: 'string' } } },
    },
    {
      name: 'another-action',
      description: 'Another test action',
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
    getSPA: () => ({ html: '<div>test</div>', css: '', js: '' }),
    getSupportedActions: () => supportedActions,
    getStateSchema: () => stateSchema,
    createController: () => createMockController(),
    ...overrides,
  };
}

function createMockInstance(appId: string, overrides?: Partial<MiniAppInstance>): MiniAppInstance {
  const app = createMockMiniApp(appId);
  return {
    app,
    controller: createMockController(),
    bridge: createMockBridge(`webapp-${appId}`),
    webappId: `webapp-${appId}`,
    launchedAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// ListMiniAppsTool Tests
// ============================================================================

describe('ListMiniAppsTool', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('returns all registered apps with metadata', async () => {
    const mockApps = [
      createMockMiniApp('app1'),
      createMockMiniApp('app2'),
    ];

    sinon.stub(MiniAppRegistry, 'getAllApps').returns(mockApps);
    sinon.stub(MiniAppRegistry, 'isRunning').returns(false);

    const tool = new ListMiniAppsTool();
    const result = await tool.execute({});

    assert.strictEqual('error' in result, false);
    if (!('error' in result)) {
      assert.strictEqual(result.count, 2);
      assert.strictEqual(result.apps.length, 2);
      assert.strictEqual(result.apps[0].id, 'app1');
      assert.strictEqual(result.apps[0].name, 'Test App app1');
      assert.strictEqual(result.apps[0].isRunning, false);
      assert.isArray(result.apps[0].supportedActions);
    }
  });

  it('includes running status for each app', async () => {
    const mockApps = [
      createMockMiniApp('app1'),
      createMockMiniApp('app2'),
    ];

    sinon.stub(MiniAppRegistry, 'getAllApps').returns(mockApps);
    const isRunningStub = sinon.stub(MiniAppRegistry, 'isRunning');
    isRunningStub.withArgs('app1').returns(true);
    isRunningStub.withArgs('app2').returns(false);

    const tool = new ListMiniAppsTool();
    const result = await tool.execute({});

    assert.strictEqual('error' in result, false);
    if (!('error' in result)) {
      assert.strictEqual(result.apps[0].isRunning, true);
      assert.strictEqual(result.apps[1].isRunning, false);
    }
  });

  it('filters to only non-running apps when includeRunning is false', async () => {
    const mockApps = [
      createMockMiniApp('app1'),
      createMockMiniApp('app2'),
    ];

    sinon.stub(MiniAppRegistry, 'getAllApps').returns(mockApps);
    const isRunningStub = sinon.stub(MiniAppRegistry, 'isRunning');
    isRunningStub.withArgs('app1').returns(true);
    isRunningStub.withArgs('app2').returns(false);

    const tool = new ListMiniAppsTool();
    const result = await tool.execute({ includeRunning: false });

    assert.strictEqual('error' in result, false);
    if (!('error' in result)) {
      assert.strictEqual(result.count, 1);
      assert.strictEqual(result.apps[0].id, 'app2');
    }
  });

  it('returns empty array when no apps registered', async () => {
    sinon.stub(MiniAppRegistry, 'getAllApps').returns([]);

    const tool = new ListMiniAppsTool();
    const result = await tool.execute({});

    assert.strictEqual('error' in result, false);
    if (!('error' in result)) {
      assert.strictEqual(result.count, 0);
      assert.deepEqual(result.apps, []);
    }
  });
});

// ============================================================================
// LaunchMiniAppTool Tests
// ============================================================================

describe('LaunchMiniAppTool', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('successfully launches app and returns instance info', async () => {
    const mockInstance = createMockInstance('test-app');

    sinon.stub(MiniAppRegistry, 'isRunning').returns(false);
    sinon.stub(MiniAppRegistry, 'launch').resolves(mockInstance);

    const tool = new LaunchMiniAppTool();
    const result = await tool.execute({ appId: 'test-app' });

    assert.strictEqual('error' in result, false);
    if (!('error' in result)) {
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.appId, 'test-app');
      assert.strictEqual(result.wasAlreadyRunning, false);
      assert.match(result.message, /Successfully launched/);
    }
  });

  it('returns existing instance when app already running (idempotent)', async () => {
    const mockInstance = createMockInstance('test-app');

    sinon.stub(MiniAppRegistry, 'isRunning').returns(true);
    sinon.stub(MiniAppRegistry, 'launch').resolves(mockInstance);

    const tool = new LaunchMiniAppTool();
    const result = await tool.execute({ appId: 'test-app' });

    assert.strictEqual('error' in result, false);
    if (!('error' in result)) {
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.wasAlreadyRunning, true);
      assert.match(result.message, /already running/);
    }
  });

  it('applies initial state when provided and app not already running', async () => {
    const controller = createMockController();
    const mockInstance = createMockInstance('test-app', { controller });

    sinon.stub(MiniAppRegistry, 'isRunning').returns(false);
    sinon.stub(MiniAppRegistry, 'launch').resolves(mockInstance);

    const tool = new LaunchMiniAppTool();
    const initialState = { key1: 'value1', key2: 42 };
    await tool.execute({ appId: 'test-app', initialState });

    sinon.assert.calledOnce(controller.setState as sinon.SinonStub);
    sinon.assert.calledWith(controller.setState as sinon.SinonStub, initialState);
  });

  it('does not apply initial state when app already running', async () => {
    const controller = createMockController();
    const mockInstance = createMockInstance('test-app', { controller });

    sinon.stub(MiniAppRegistry, 'isRunning').returns(true);
    sinon.stub(MiniAppRegistry, 'launch').resolves(mockInstance);

    const tool = new LaunchMiniAppTool();
    await tool.execute({ appId: 'test-app', initialState: { key: 'value' } });

    sinon.assert.notCalled(controller.setState as sinon.SinonStub);
  });

  it('returns error when appId not provided', async () => {
    const tool = new LaunchMiniAppTool();
    const result = await tool.execute({ appId: '' });

    assert.strictEqual('error' in result, true);
    if ('error' in result) {
      assert.match(result.error, /appId is required/);
    }
  });

  it('returns error when app ID not found', async () => {
    sinon.stub(MiniAppRegistry, 'isRunning').returns(false);
    sinon.stub(MiniAppRegistry, 'launch').rejects(new Error('Mini app "unknown-app" is not registered'));

    const tool = new LaunchMiniAppTool();
    const result = await tool.execute({ appId: 'unknown-app' });

    assert.strictEqual('error' in result, true);
    if ('error' in result) {
      assert.match(result.error, /not registered/);
    }
  });
});

// ============================================================================
// GetMiniAppStateTool Tests
// ============================================================================

describe('GetMiniAppStateTool', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('returns current state from running app', async () => {
    const expectedState = { key1: 'value1', key2: 123 };
    const controller = createMockController({
      getState: sinon.stub().resolves(expectedState),
    });
    const mockInstance = createMockInstance('test-app', { controller });

    sinon.stub(MiniAppRegistry, 'getRunningInstance').returns(mockInstance);

    const tool = new GetMiniAppStateTool();
    const result = await tool.execute({ appId: 'test-app' });

    assert.strictEqual('error' in result, false);
    if (!('error' in result)) {
      assert.strictEqual(result.appId, 'test-app');
      assert.deepEqual(result.state, expectedState);
    }
  });

  it('includes state schema in response', async () => {
    const mockInstance = createMockInstance('test-app');
    sinon.stub(MiniAppRegistry, 'getRunningInstance').returns(mockInstance);

    const tool = new GetMiniAppStateTool();
    const result = await tool.execute({ appId: 'test-app' });

    assert.strictEqual('error' in result, false);
    if (!('error' in result)) {
      assert.isDefined(result.stateSchema);
      assert.strictEqual((result.stateSchema as any).type, 'object');
    }
  });

  it('returns error when app not running', async () => {
    sinon.stub(MiniAppRegistry, 'getRunningInstance').returns(undefined);

    const tool = new GetMiniAppStateTool();
    const result = await tool.execute({ appId: 'not-running' });

    assert.strictEqual('error' in result, true);
    if ('error' in result) {
      assert.match(result.error, /not running/);
    }
  });

  it('handles empty state correctly', async () => {
    const controller = createMockController({
      getState: sinon.stub().resolves({}),
    });
    const mockInstance = createMockInstance('test-app', { controller });

    sinon.stub(MiniAppRegistry, 'getRunningInstance').returns(mockInstance);

    const tool = new GetMiniAppStateTool();
    const result = await tool.execute({ appId: 'test-app' });

    assert.strictEqual('error' in result, false);
    if (!('error' in result)) {
      assert.deepEqual(result.state, {});
    }
  });
});

// ============================================================================
// UpdateMiniAppStateTool Tests
// ============================================================================

describe('UpdateMiniAppStateTool', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('merges partial state updates by default', async () => {
    const controller = createMockController({
      getState: sinon.stub().resolves({ key1: 'new', key2: 'existing' }),
    });
    const mockInstance = createMockInstance('test-app', { controller });

    sinon.stub(MiniAppRegistry, 'getRunningInstance').returns(mockInstance);

    const tool = new UpdateMiniAppStateTool();
    const result = await tool.execute({ appId: 'test-app', updates: { key1: 'new' } });

    assert.strictEqual('error' in result, false);
    if (!('error' in result)) {
      assert.strictEqual(result.success, true);
      assert.match(result.message, /updated successfully/);
    }
    sinon.assert.calledOnce(controller.updateState as sinon.SinonStub);
    sinon.assert.notCalled(controller.setState as sinon.SinonStub);
  });

  it('replaces full state when replace is true', async () => {
    const newState = { newKey: 'newValue' };
    const controller = createMockController({
      getState: sinon.stub().resolves(newState),
    });
    const mockInstance = createMockInstance('test-app', { controller });

    sinon.stub(MiniAppRegistry, 'getRunningInstance').returns(mockInstance);

    const tool = new UpdateMiniAppStateTool();
    const result = await tool.execute({ appId: 'test-app', updates: newState, replace: true });

    assert.strictEqual('error' in result, false);
    if (!('error' in result)) {
      assert.strictEqual(result.success, true);
      assert.match(result.message, /replaced successfully/);
    }
    sinon.assert.calledOnce(controller.setState as sinon.SinonStub);
    sinon.assert.notCalled(controller.updateState as sinon.SinonStub);
  });

  it('returns error when app not running', async () => {
    sinon.stub(MiniAppRegistry, 'getRunningInstance').returns(undefined);

    const tool = new UpdateMiniAppStateTool();
    const result = await tool.execute({ appId: 'not-running', updates: { key: 'value' } });

    assert.strictEqual('error' in result, true);
    if ('error' in result) {
      assert.match(result.error, /not running/);
    }
  });

  it('returns error when updates is not an object', async () => {
    const tool = new UpdateMiniAppStateTool();
    const result = await tool.execute({ appId: 'test-app', updates: null as any });

    assert.strictEqual('error' in result, true);
    if ('error' in result) {
      assert.match(result.error, /updates must be an object/);
    }
  });
});

// ============================================================================
// ExecuteMiniAppActionTool Tests
// ============================================================================

describe('ExecuteMiniAppActionTool', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('executes valid action and returns result', async () => {
    const actionResult = { data: 'action completed' };
    const controller = createMockController({
      executeAction: sinon.stub().resolves(actionResult),
    });
    const mockInstance = createMockInstance('test-app', { controller });

    sinon.stub(MiniAppRegistry, 'getRunningInstance').returns(mockInstance);

    const tool = new ExecuteMiniAppActionTool();
    const result = await tool.execute({
      appId: 'test-app',
      actionName: 'test-action',
      args: { arg1: 'value' },
    });

    assert.strictEqual('error' in result, false);
    if (!('error' in result)) {
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.actionName, 'test-action');
      assert.deepEqual(result.result, actionResult);
    }
    sinon.assert.calledWith(controller.executeAction as sinon.SinonStub, 'test-action', { arg1: 'value' });
  });

  it('passes empty object when args not provided', async () => {
    const controller = createMockController();
    const mockInstance = createMockInstance('test-app', { controller });

    sinon.stub(MiniAppRegistry, 'getRunningInstance').returns(mockInstance);

    const tool = new ExecuteMiniAppActionTool();
    await tool.execute({ appId: 'test-app', actionName: 'test-action' });

    sinon.assert.calledWith(controller.executeAction as sinon.SinonStub, 'test-action', {});
  });

  it('returns error when action name not supported', async () => {
    const mockInstance = createMockInstance('test-app');
    sinon.stub(MiniAppRegistry, 'getRunningInstance').returns(mockInstance);

    const tool = new ExecuteMiniAppActionTool();
    const result = await tool.execute({ appId: 'test-app', actionName: 'unsupported-action' });

    assert.strictEqual('error' in result, true);
    if ('error' in result) {
      assert.match(result.error, /not supported/);
      assert.match(result.error, /Available actions/);
    }
  });

  it('returns error when app not running', async () => {
    sinon.stub(MiniAppRegistry, 'getRunningInstance').returns(undefined);

    const tool = new ExecuteMiniAppActionTool();
    const result = await tool.execute({ appId: 'not-running', actionName: 'test-action' });

    assert.strictEqual('error' in result, true);
    if ('error' in result) {
      assert.match(result.error, /not running/);
    }
  });
});

// ============================================================================
// CloseMiniAppTool Tests
// ============================================================================

describe('CloseMiniAppTool', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('closes running app successfully', async () => {
    sinon.stub(MiniAppRegistry, 'isRunning').returns(true);
    const closeStub = sinon.stub(MiniAppRegistry, 'close').resolves();

    const tool = new CloseMiniAppTool();
    const result = await tool.execute({ appId: 'test-app' });

    assert.strictEqual('error' in result, false);
    if (!('error' in result)) {
      assert.strictEqual(result.success, true);
      assert.match(result.message, /closed successfully/);
    }
    sinon.assert.calledOnce(closeStub);
    sinon.assert.calledWith(closeStub, 'test-app');
  });

  it('handles close of already-closed app gracefully', async () => {
    sinon.stub(MiniAppRegistry, 'isRunning').returns(false);

    const tool = new CloseMiniAppTool();
    const result = await tool.execute({ appId: 'not-running' });

    assert.strictEqual('error' in result, false);
    if (!('error' in result)) {
      assert.strictEqual(result.success, true);
      assert.match(result.message, /was not running/);
    }
  });

  it('returns error when close fails', async () => {
    sinon.stub(MiniAppRegistry, 'isRunning').returns(true);
    sinon.stub(MiniAppRegistry, 'close').rejects(new Error('Close failed'));

    const tool = new CloseMiniAppTool();
    const result = await tool.execute({ appId: 'test-app' });

    assert.strictEqual('error' in result, true);
    if ('error' in result) {
      assert.match(result.error, /Close failed/);
    }
  });
});
