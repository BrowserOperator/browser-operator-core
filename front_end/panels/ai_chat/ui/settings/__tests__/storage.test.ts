// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {
  getStorageItem,
  setStorageItem,
  getStorageBoolean,
  setStorageBoolean,
  getStorageJSON,
  setStorageJSON,
  removeStorageItem,
  isVectorDBEnabled,
} from '../utils/storage.js';

describe('Storage Utilities', () => {
  // Store original localStorage for cleanup
  let originalLocalStorage: Storage;
  let mockStorage: Map<string, string>;

  beforeEach(() => {
    // Create a mock localStorage
    mockStorage = new Map();
    originalLocalStorage = window.localStorage;

    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (key: string) => mockStorage.get(key) ?? null,
        setItem: (key: string, value: string) => mockStorage.set(key, value),
        removeItem: (key: string) => mockStorage.delete(key),
        clear: () => mockStorage.clear(),
        get length() {
          return mockStorage.size;
        },
        key: (index: number) => Array.from(mockStorage.keys())[index] ?? null,
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    // Restore original localStorage
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });
  });

  describe('getStorageItem', () => {
    it('returns stored value', () => {
      mockStorage.set('test_key', 'test_value');
      assert.strictEqual(getStorageItem('test_key'), 'test_value');
    });

    it('returns empty string for missing key with no default', () => {
      assert.strictEqual(getStorageItem('missing_key'), '');
    });

    it('returns default value for missing key', () => {
      assert.strictEqual(getStorageItem('missing_key', 'default'), 'default');
    });

    it('returns stored value even when default is provided', () => {
      mockStorage.set('test_key', 'stored');
      assert.strictEqual(getStorageItem('test_key', 'default'), 'stored');
    });
  });

  describe('setStorageItem', () => {
    it('stores non-empty value', () => {
      setStorageItem('test_key', 'test_value');
      assert.strictEqual(mockStorage.get('test_key'), 'test_value');
    });

    it('removes key for empty string', () => {
      mockStorage.set('test_key', 'old_value');
      setStorageItem('test_key', '');
      assert.isFalse(mockStorage.has('test_key'));
    });

    it('removes key for whitespace-only string', () => {
      mockStorage.set('test_key', 'old_value');
      setStorageItem('test_key', '   ');
      assert.isFalse(mockStorage.has('test_key'));
    });

    it('stores string with leading/trailing whitespace', () => {
      setStorageItem('test_key', '  value  ');
      assert.strictEqual(mockStorage.get('test_key'), '  value  ');
    });
  });

  describe('getStorageBoolean', () => {
    it('returns true for "true" string', () => {
      mockStorage.set('bool_key', 'true');
      assert.isTrue(getStorageBoolean('bool_key'));
    });

    it('returns false for "false" string', () => {
      mockStorage.set('bool_key', 'false');
      assert.isFalse(getStorageBoolean('bool_key'));
    });

    it('returns false for non-boolean strings', () => {
      mockStorage.set('bool_key', 'yes');
      assert.isFalse(getStorageBoolean('bool_key'));

      mockStorage.set('bool_key', '1');
      assert.isFalse(getStorageBoolean('bool_key'));
    });

    it('returns default value for missing key', () => {
      assert.isFalse(getStorageBoolean('missing_key'));
      assert.isTrue(getStorageBoolean('missing_key', true));
      assert.isFalse(getStorageBoolean('missing_key', false));
    });
  });

  describe('setStorageBoolean', () => {
    it('stores true as "true"', () => {
      setStorageBoolean('bool_key', true);
      assert.strictEqual(mockStorage.get('bool_key'), 'true');
    });

    it('stores false as "false"', () => {
      setStorageBoolean('bool_key', false);
      assert.strictEqual(mockStorage.get('bool_key'), 'false');
    });
  });

  describe('getStorageJSON', () => {
    it('returns parsed JSON object', () => {
      mockStorage.set('json_key', '{"name":"test","value":123}');
      const result = getStorageJSON('json_key', {});
      assert.deepEqual(result, {name: 'test', value: 123});
    });

    it('returns parsed JSON array', () => {
      mockStorage.set('json_key', '[1,2,3]');
      const result = getStorageJSON('json_key', []);
      assert.deepEqual(result, [1, 2, 3]);
    });

    it('returns default for missing key', () => {
      const defaultValue = {default: true};
      const result = getStorageJSON('missing_key', defaultValue);
      assert.deepEqual(result, defaultValue);
    });

    it('returns default for invalid JSON', () => {
      mockStorage.set('json_key', 'not valid json');
      const defaultValue = {error: true};
      const result = getStorageJSON('json_key', defaultValue);
      assert.deepEqual(result, defaultValue);
    });

    it('returns default for partial JSON', () => {
      mockStorage.set('json_key', '{"incomplete":');
      const defaultValue: object = {};
      const result = getStorageJSON('json_key', defaultValue);
      assert.deepEqual(result, defaultValue);
    });

    it('handles null JSON value', () => {
      mockStorage.set('json_key', 'null');
      const result = getStorageJSON<object | null>('json_key', {fallback: true});
      assert.isNull(result);
    });
  });

  describe('setStorageJSON', () => {
    it('stores object as JSON string', () => {
      setStorageJSON('json_key', {name: 'test', value: 123});
      const stored = mockStorage.get('json_key');
      assert.strictEqual(stored, '{"name":"test","value":123}');
    });

    it('stores array as JSON string', () => {
      setStorageJSON('json_key', [1, 2, 3]);
      const stored = mockStorage.get('json_key');
      assert.strictEqual(stored, '[1,2,3]');
    });

    it('stores nested objects', () => {
      const complex = {
        level1: {
          level2: {
            value: 'deep',
          },
        },
      };
      setStorageJSON('json_key', complex);
      const result = getStorageJSON('json_key', {});
      assert.deepEqual(result, complex);
    });

    it('stores null', () => {
      setStorageJSON('json_key', null);
      assert.strictEqual(mockStorage.get('json_key'), 'null');
    });
  });

  describe('removeStorageItem', () => {
    it('removes existing key', () => {
      mockStorage.set('test_key', 'value');
      removeStorageItem('test_key');
      assert.isFalse(mockStorage.has('test_key'));
    });

    it('handles removing non-existent key', () => {
      // Should not throw
      removeStorageItem('non_existent');
      assert.isFalse(mockStorage.has('non_existent'));
    });
  });

  describe('isVectorDBEnabled', () => {
    it('returns false when not set', () => {
      assert.isFalse(isVectorDBEnabled());
    });

    it('returns true when enabled', () => {
      mockStorage.set('ai_chat_vector_db_enabled', 'true');
      assert.isTrue(isVectorDBEnabled());
    });

    it('returns false when disabled', () => {
      mockStorage.set('ai_chat_vector_db_enabled', 'false');
      assert.isFalse(isVectorDBEnabled());
    });
  });

  describe('Round-trip Tests', () => {
    it('preserves string values through round trip', () => {
      const original = 'Hello, World!';
      setStorageItem('test', original);
      assert.strictEqual(getStorageItem('test'), original);
    });

    it('preserves boolean values through round trip', () => {
      setStorageBoolean('test', true);
      assert.isTrue(getStorageBoolean('test'));

      setStorageBoolean('test', false);
      assert.isFalse(getStorageBoolean('test'));
    });

    it('preserves complex JSON through round trip', () => {
      const complex = {
        string: 'value',
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        nested: {inner: 'deep'},
        nullValue: null,
      };
      setStorageJSON('test', complex);
      assert.deepEqual(getStorageJSON('test', {}), complex);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty string key', () => {
      setStorageItem('', 'value');
      assert.strictEqual(getStorageItem(''), 'value');
    });

    it('handles special characters in keys', () => {
      const specialKey = 'key:with/special-chars.and_underscores';
      setStorageItem(specialKey, 'value');
      assert.strictEqual(getStorageItem(specialKey), 'value');
    });

    it('handles unicode in values', () => {
      const unicodeValue = 'Hello \u{1F600} World \u4E2D\u6587';
      setStorageItem('unicode', unicodeValue);
      assert.strictEqual(getStorageItem('unicode'), unicodeValue);
    });

    it('handles very long strings', () => {
      const longString = 'A'.repeat(10000);
      setStorageItem('long', longString);
      assert.strictEqual(getStorageItem('long'), longString);
    });
  });
});
