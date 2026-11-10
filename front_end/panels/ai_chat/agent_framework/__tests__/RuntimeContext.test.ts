// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Tests for RuntimeContext module.
 * Tests ID generation, time utilities, and runtime context switching.
 */

import { defaultRuntime, getRuntime, setRuntime, type RuntimeContext } from '../RuntimeContext.js';

// ============================================================================
// Tests
// ============================================================================

describe('ai_chat: RuntimeContext', () => {
  // Store original runtime for restoration
  let originalRuntime: RuntimeContext;

  beforeEach(() => {
    originalRuntime = getRuntime();
  });

  afterEach(() => {
    // Restore to default runtime after each test
    setRuntime(originalRuntime);
  });

  // ==========================================================================
  // Default Runtime Tests
  // ==========================================================================

  describe('defaultRuntime', () => {
    describe('generateId', () => {
      it('generates a non-empty string ID', () => {
        const id = defaultRuntime.generateId();
        assert.isString(id);
        assert.isNotEmpty(id);
      });

      it('generates unique IDs on successive calls', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 100; i++) {
          ids.add(defaultRuntime.generateId());
        }
        assert.strictEqual(ids.size, 100, 'All 100 IDs should be unique');
      });

      it('generates valid UUID format when crypto.randomUUID is available', () => {
        // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const id = defaultRuntime.generateId();

        // In browser environment with crypto.randomUUID, should match UUID format
        // If fallback is used, this test will still pass but may not match UUID format
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
          assert.match(id, uuidRegex, 'Should be a valid UUID v4 format');
        } else {
          // Fallback format: id-{timestamp}-{random}
          assert.match(id, /^id-\d+-[a-z0-9]+$/, 'Should match fallback format');
        }
      });
    });

    describe('now', () => {
      it('returns a Date object', () => {
        const date = defaultRuntime.now();
        assert.instanceOf(date, Date);
      });

      it('returns current time (within tolerance)', () => {
        const before = Date.now();
        const result = defaultRuntime.now();
        const after = Date.now();

        assert.isAtLeast(result.getTime(), before);
        assert.isAtMost(result.getTime(), after);
      });

      it('returns new Date instances on each call', () => {
        const date1 = defaultRuntime.now();
        const date2 = defaultRuntime.now();

        // Should be different object instances
        assert.notStrictEqual(date1, date2);
      });
    });
  });

  // ==========================================================================
  // Runtime Context Switching Tests
  // ==========================================================================

  describe('getRuntime and setRuntime', () => {
    it('returns default runtime initially', () => {
      setRuntime(defaultRuntime);
      const runtime = getRuntime();
      assert.strictEqual(runtime, defaultRuntime);
    });

    it('allows switching to custom runtime', () => {
      const customRuntime: RuntimeContext = {
        generateId: () => 'custom-id-123',
        now: () => new Date('2025-01-01T00:00:00Z'),
      };

      setRuntime(customRuntime);
      const runtime = getRuntime();

      assert.strictEqual(runtime, customRuntime);
      assert.strictEqual(runtime.generateId(), 'custom-id-123');
      assert.strictEqual(runtime.now().toISOString(), '2025-01-01T00:00:00.000Z');
    });

    it('allows switching back to default runtime', () => {
      const customRuntime: RuntimeContext = {
        generateId: () => 'temporary-id',
        now: () => new Date(0),
      };

      setRuntime(customRuntime);
      assert.strictEqual(getRuntime().generateId(), 'temporary-id');

      setRuntime(defaultRuntime);
      assert.notStrictEqual(getRuntime().generateId(), 'temporary-id');
    });

    it('supports mock runtime for testing deterministic behavior', () => {
      let counter = 0;
      const mockRuntime: RuntimeContext = {
        generateId: () => `mock-id-${++counter}`,
        now: () => new Date('2025-06-15T12:00:00Z'),
      };

      setRuntime(mockRuntime);

      // Verify deterministic ID generation
      assert.strictEqual(getRuntime().generateId(), 'mock-id-1');
      assert.strictEqual(getRuntime().generateId(), 'mock-id-2');
      assert.strictEqual(getRuntime().generateId(), 'mock-id-3');

      // Verify fixed time
      assert.strictEqual(getRuntime().now().toISOString(), '2025-06-15T12:00:00.000Z');
      assert.strictEqual(getRuntime().now().toISOString(), '2025-06-15T12:00:00.000Z');
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('handles runtime with throwing generateId gracefully', () => {
      const throwingRuntime: RuntimeContext = {
        generateId: () => {
          throw new Error('ID generation failed');
        },
        now: () => new Date(),
      };

      setRuntime(throwingRuntime);

      // Verify the error propagates (caller should handle)
      assert.throws(() => getRuntime().generateId(), /ID generation failed/);
    });

    it('handles runtime with throwing now gracefully', () => {
      const throwingRuntime: RuntimeContext = {
        generateId: () => 'ok',
        now: () => {
          throw new Error('Time retrieval failed');
        },
      };

      setRuntime(throwingRuntime);

      assert.strictEqual(getRuntime().generateId(), 'ok');
      assert.throws(() => getRuntime().now(), /Time retrieval failed/);
    });

    it('maintains runtime across multiple getRuntime calls', () => {
      const customRuntime: RuntimeContext = {
        generateId: () => 'stable-id',
        now: () => new Date('2025-01-01T00:00:00Z'),
      };

      setRuntime(customRuntime);

      // Multiple calls should return same runtime
      const runtime1 = getRuntime();
      const runtime2 = getRuntime();
      const runtime3 = getRuntime();

      assert.strictEqual(runtime1, runtime2);
      assert.strictEqual(runtime2, runtime3);
    });
  });
});
