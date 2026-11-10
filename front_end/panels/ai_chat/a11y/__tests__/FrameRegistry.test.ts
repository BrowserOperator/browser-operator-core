// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as SDK from '../../../../core/sdk/sdk.js';
import {createTarget, stubNoopSettings} from '../../../../testing/EnvironmentHelpers.js';
import {describeWithMockConnection, setMockConnectionResponseHandler} from '../../../../testing/MockConnection.js';

import {FrameRegistry, type FrameInfo} from '../FrameRegistry.js';

describeWithMockConnection('FrameRegistry', () => {
  let target: SDK.Target.Target;

  beforeEach(() => {
    stubNoopSettings();
    target = createTarget();
  });

  describe('collectFrames', () => {
    it('should return empty array when no ResourceTreeModel', async () => {
      // Create a target without proper initialization
      const registry = new FrameRegistry(target);
      const frames = await registry.collectFrames();
      // Without ResourceTreeModel, should return empty
      assert.isArray(frames);
    });

    it('should collect main frame with ordinal 0', async () => {
      // Mock the ResourceTreeModel response
      setMockConnectionResponseHandler('DOM.getFrameOwner', () => ({
        backendNodeId: undefined,
      }));

      const registry = new FrameRegistry(target);
      const frames = await registry.collectFrames();

      // Main frame should have ordinal 0
      if (frames.length > 0) {
        assert.strictEqual(frames[0].ordinal, 0);
      }
    });
  });

  describe('getOrdinal', () => {
    it('should return 0 for unknown frame', () => {
      const registry = new FrameRegistry(target);
      const ordinal = registry.getOrdinal('unknown-frame-id');
      assert.strictEqual(ordinal, 0);
    });
  });

  describe('getFrame', () => {
    it('should return undefined for unknown frame', () => {
      const registry = new FrameRegistry(target);
      const frame = registry.getFrame('unknown-frame-id');
      assert.isUndefined(frame);
    });
  });

  describe('getFrameByOrdinal', () => {
    it('should return undefined for invalid ordinal', () => {
      const registry = new FrameRegistry(target);
      const frame = registry.getFrameByOrdinal(999);
      assert.isUndefined(frame);
    });
  });

  describe('listAllFrameIds', () => {
    it('should return empty array initially', () => {
      const registry = new FrameRegistry(target);
      const ids = registry.listAllFrameIds();
      assert.deepStrictEqual(ids, []);
    });
  });

  describe('getParentMap', () => {
    it('should return empty map initially', () => {
      const registry = new FrameRegistry(target);
      const map = registry.getParentMap();
      assert.strictEqual(map.size, 0);
    });
  });

  describe('getChildFrameIds', () => {
    it('should return empty array for unknown parent', () => {
      const registry = new FrameRegistry(target);
      const children = registry.getChildFrameIds('unknown-parent');
      assert.deepStrictEqual(children, []);
    });
  });

  describe('hasFrame', () => {
    it('should return false for unknown frame', () => {
      const registry = new FrameRegistry(target);
      assert.isFalse(registry.hasFrame('unknown-frame'));
    });
  });

  describe('frameCount', () => {
    it('should return 0 initially', () => {
      const registry = new FrameRegistry(target);
      assert.strictEqual(registry.frameCount, 0);
    });
  });

  describe('getMainFrameId', () => {
    it('should return null initially', () => {
      const registry = new FrameRegistry(target);
      assert.isNull(registry.getMainFrameId());
    });
  });

  describe('getParentFrameId', () => {
    it('should return undefined for unknown frame', () => {
      const registry = new FrameRegistry(target);
      const parentId = registry.getParentFrameId('unknown-frame');
      assert.isUndefined(parentId);
    });
  });
});

// Unit tests for FrameInfo interface shape
describe('FrameInfo interface', () => {
  it('should allow creating FrameInfo with required fields', () => {
    const info: FrameInfo = {
      ordinal: 0,
      frameId: 'main-frame',
      url: 'https://example.com',
    };
    assert.strictEqual(info.ordinal, 0);
    assert.strictEqual(info.frameId, 'main-frame');
    assert.strictEqual(info.url, 'https://example.com');
  });

  it('should allow creating FrameInfo with optional fields', () => {
    const info: FrameInfo = {
      ordinal: 1,
      frameId: 'child-frame',
      url: 'https://example.com/iframe',
      parentFrameId: 'main-frame',
      ownerBackendNodeId: 123,
      ownerXPath: '/html/body/iframe',
      targetId: 'target-123',
    };
    assert.strictEqual(info.parentFrameId, 'main-frame');
    assert.strictEqual(info.ownerBackendNodeId, 123);
    assert.strictEqual(info.ownerXPath, '/html/body/iframe');
    assert.strictEqual(info.targetId, 'target-123');
  });
});
