// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {
  makeEncodedId,
  parseEncodedId,
  isEncodedId,
  type EncodedId,
} from './context.js';

describe('EncodedId', () => {
  describe('makeEncodedId', () => {
    it('should create valid EncodedId format', () => {
      assert.strictEqual(makeEncodedId(0, 123), '0-123');
      assert.strictEqual(makeEncodedId(2, 456), '2-456');
    });

    it('should handle zero values', () => {
      assert.strictEqual(makeEncodedId(0, 0), '0-0');
    });

    it('should handle large numbers', () => {
      assert.strictEqual(makeEncodedId(999, 999999), '999-999999');
    });

    it('should handle single digit values', () => {
      assert.strictEqual(makeEncodedId(1, 5), '1-5');
    });

    it('should return type EncodedId', () => {
      const result = makeEncodedId(0, 42);
      // TypeScript type check - result should be assignable to EncodedId
      const typed: EncodedId = result;
      assert.strictEqual(typed, '0-42');
    });
  });

  describe('parseEncodedId', () => {
    it('should parse valid EncodedId', () => {
      const result = parseEncodedId('0-123');
      assert.deepStrictEqual(result, {frameOrdinal: 0, backendNodeId: 123});
    });

    it('should parse EncodedId with larger numbers', () => {
      const result = parseEncodedId('5-9999');
      assert.deepStrictEqual(result, {frameOrdinal: 5, backendNodeId: 9999});
    });

    it('should handle zero frame ordinal', () => {
      const result = parseEncodedId('0-456');
      assert.deepStrictEqual(result, {frameOrdinal: 0, backendNodeId: 456});
    });

    it('should handle zero backend node ID', () => {
      const result = parseEncodedId('3-0');
      assert.deepStrictEqual(result, {frameOrdinal: 3, backendNodeId: 0});
    });

    it('should return null for invalid format - missing hyphen', () => {
      const result = parseEncodedId('123');
      assert.isNull(result);
    });

    it('should return null for invalid format - extra hyphens', () => {
      const result = parseEncodedId('1-2-3');
      assert.isNull(result);
    });

    it('should return null for non-numeric values', () => {
      const result = parseEncodedId('abc-123');
      assert.isNull(result);
    });

    it('should return null for non-numeric backend node ID', () => {
      const result = parseEncodedId('0-xyz');
      assert.isNull(result);
    });

    it('should return null for negative values', () => {
      const result = parseEncodedId('-1-123');
      assert.isNull(result);
    });

    it('should return null for empty string', () => {
      const result = parseEncodedId('');
      assert.isNull(result);
    });

    it('should return null for whitespace', () => {
      const result = parseEncodedId('  ');
      assert.isNull(result);
    });

    it('should return null for decimal values', () => {
      const result = parseEncodedId('1.5-123');
      assert.isNull(result);
    });

    it('should handle edge case 0-0', () => {
      const result = parseEncodedId('0-0');
      assert.deepStrictEqual(result, {frameOrdinal: 0, backendNodeId: 0});
    });

    it('should handle large numbers', () => {
      const result = parseEncodedId('999999-888888');
      assert.deepStrictEqual(result, {frameOrdinal: 999999, backendNodeId: 888888});
    });
  });

  describe('isEncodedId', () => {
    it('should return true for valid EncodedIds', () => {
      assert.isTrue(isEncodedId('0-123'));
      assert.isTrue(isEncodedId('5-456'));
      assert.isTrue(isEncodedId('99-99999'));
    });

    it('should return true for 0-0', () => {
      assert.isTrue(isEncodedId('0-0'));
    });

    it('should return true for single digit values', () => {
      assert.isTrue(isEncodedId('1-2'));
    });

    it('should return false for invalid formats', () => {
      assert.isFalse(isEncodedId('123'));
      assert.isFalse(isEncodedId('abc'));
      assert.isFalse(isEncodedId('0-'));
      assert.isFalse(isEncodedId('-123'));
    });

    it('should return false for empty strings', () => {
      assert.isFalse(isEncodedId(''));
    });

    it('should return false for whitespace only', () => {
      assert.isFalse(isEncodedId('   '));
    });

    it('should return false for multiple hyphens', () => {
      assert.isFalse(isEncodedId('1-2-3'));
    });

    it('should return false for non-numeric parts', () => {
      assert.isFalse(isEncodedId('a-1'));
      assert.isFalse(isEncodedId('1-a'));
      assert.isFalse(isEncodedId('a-b'));
    });

    it('should return false for decimal values', () => {
      assert.isFalse(isEncodedId('1.5-2'));
      assert.isFalse(isEncodedId('1-2.5'));
    });

    it('should return false for negative values', () => {
      assert.isFalse(isEncodedId('-1-2'));
      assert.isFalse(isEncodedId('1--2'));
    });

    it('should return false for XPath-like strings', () => {
      assert.isFalse(isEncodedId('/html/body'));
    });

    it('should return false for CSS selector-like strings', () => {
      assert.isFalse(isEncodedId('#button-123'));
    });
  });

  describe('roundtrip', () => {
    it('should roundtrip correctly', () => {
      const original = makeEncodedId(3, 789);
      const parsed = parseEncodedId(original);
      assert.isNotNull(parsed);
      const reconstructed = makeEncodedId(parsed!.frameOrdinal, parsed!.backendNodeId);
      assert.strictEqual(reconstructed, original);
    });

    it('should roundtrip with various values', () => {
      const testCases = [
        {frameOrdinal: 0, backendNodeId: 1},
        {frameOrdinal: 1, backendNodeId: 0},
        {frameOrdinal: 99, backendNodeId: 9999},
        {frameOrdinal: 0, backendNodeId: 0},
      ];

      for (const tc of testCases) {
        const encoded = makeEncodedId(tc.frameOrdinal, tc.backendNodeId);
        const decoded = parseEncodedId(encoded);
        assert.deepStrictEqual(decoded, tc);
      }
    });
  });
});
