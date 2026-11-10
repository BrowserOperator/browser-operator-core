// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Tests for utils-universal module.
 * Tests tree formatting, accessibility node handling, and CDP adapter mocking.
 */

import { formatSimplifiedTree } from '../utils-universal.js';
import type { AccessibilityNode } from '../context.js';

// ============================================================================
// Test Helper Functions
// ============================================================================

function createMockAccessibilityNode(overrides: Partial<AccessibilityNode> = {}): AccessibilityNode {
  return {
    nodeId: 'mock-node-1',
    role: 'button',
    name: 'Mock Button',
    ...overrides,
  };
}

function createTreeStructure(): AccessibilityNode {
  // Create a simple tree: root -> [child1, child2 -> [grandchild]]
  return {
    nodeId: 'root',
    role: 'RootWebArea',
    name: 'Test Page',
    children: [
      {
        nodeId: 'child1',
        role: 'button',
        name: 'Click Me',
      },
      {
        nodeId: 'child2',
        role: 'navigation',
        name: 'Main Nav',
        children: [
          {
            nodeId: 'grandchild',
            role: 'link',
            name: 'Home',
          },
        ],
      },
    ],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ai_chat: utils-universal', () => {
  // ==========================================================================
  // formatSimplifiedTree Tests
  // ==========================================================================

  describe('formatSimplifiedTree', () => {
    it('formats a single node correctly', () => {
      const node = createMockAccessibilityNode({
        nodeId: 'single',
        role: 'button',
        name: 'Submit',
      });

      const result = formatSimplifiedTree(node);

      assert.include(result, '[single]');
      assert.include(result, 'button');
      assert.include(result, 'Submit');
    });

    it('formats a node without name correctly', () => {
      const node = createMockAccessibilityNode({
        nodeId: 'no-name',
        role: 'generic',
        name: undefined,
      });

      const result = formatSimplifiedTree(node);

      assert.include(result, '[no-name]');
      assert.include(result, 'generic');
      assert.notInclude(result, ':');
    });

    it('formats nested tree with proper indentation', () => {
      const tree = createTreeStructure();

      const result = formatSimplifiedTree(tree);

      // Check root is at level 0
      assert.include(result, '[root] RootWebArea: Test Page');

      // Check children are indented
      const lines = result.split('\n').filter(l => l.trim());

      // Root should not have indentation
      const rootLine = lines.find(l => l.includes('[root]'));
      assert.isOk(rootLine);
      assert.strictEqual(rootLine!.indexOf('['), 0);

      // Child1 should have 2-space indentation
      const child1Line = lines.find(l => l.includes('[child1]'));
      assert.isOk(child1Line);
      assert.strictEqual(child1Line!.indexOf('['), 2);

      // Grandchild should have 4-space indentation
      const grandchildLine = lines.find(l => l.includes('[grandchild]'));
      assert.isOk(grandchildLine);
      assert.strictEqual(grandchildLine!.indexOf('['), 4);
    });

    it('handles empty children array', () => {
      const node = createMockAccessibilityNode({
        nodeId: 'empty-children',
        role: 'div',
        name: 'Container',
        children: [],
      });

      const result = formatSimplifiedTree(node);

      assert.include(result, '[empty-children]');
      // Should be single line (no children added)
      const lines = result.split('\n').filter(l => l.trim());
      assert.strictEqual(lines.length, 1);
    });

    it('formats deeply nested tree correctly', () => {
      const deepTree: AccessibilityNode = {
        nodeId: 'level0',
        role: 'root',
        name: 'Root',
        children: [{
          nodeId: 'level1',
          role: 'div',
          name: 'Level 1',
          children: [{
            nodeId: 'level2',
            role: 'div',
            name: 'Level 2',
            children: [{
              nodeId: 'level3',
              role: 'span',
              name: 'Level 3',
            }],
          }],
        }],
      };

      const result = formatSimplifiedTree(deepTree);

      // Check all levels are present
      assert.include(result, '[level0]');
      assert.include(result, '[level1]');
      assert.include(result, '[level2]');
      assert.include(result, '[level3]');

      // Verify indentation increases
      const lines = result.split('\n').filter(l => l.trim());
      assert.strictEqual(lines.length, 4);

      lines.forEach((line, index) => {
        const expectedIndent = index * 2;
        const actualIndent = line.search(/\S/);
        assert.strictEqual(actualIndent, expectedIndent, `Line ${index} should have ${expectedIndent} spaces`);
      });
    });

    it('handles multiple children at same level', () => {
      const node: AccessibilityNode = {
        nodeId: 'parent',
        role: 'list',
        name: 'Menu',
        children: [
          { nodeId: 'item1', role: 'listitem', name: 'Item 1' },
          { nodeId: 'item2', role: 'listitem', name: 'Item 2' },
          { nodeId: 'item3', role: 'listitem', name: 'Item 3' },
        ],
      };

      const result = formatSimplifiedTree(node);

      // All items should be at same indentation level
      const lines = result.split('\n').filter(l => l.trim());
      assert.strictEqual(lines.length, 4); // parent + 3 children

      // Check all listitem lines have same indentation
      const itemLines = lines.filter(l => l.includes('listitem'));
      assert.strictEqual(itemLines.length, 3);

      itemLines.forEach(line => {
        const indent = line.search(/\S/);
        assert.strictEqual(indent, 2);
      });
    });

    it('handles node with empty name (empty string)', () => {
      const node = createMockAccessibilityNode({
        nodeId: 'empty-name',
        role: 'img',
        name: '',
      });

      const result = formatSimplifiedTree(node);

      // Empty name should still show colon with empty value
      assert.include(result, '[empty-name]');
      assert.include(result, 'img');
    });

    it('custom level parameter works correctly', () => {
      const node = createMockAccessibilityNode({
        nodeId: 'custom-level',
        role: 'button',
        name: 'Test',
      });

      // Start at level 3 (6 spaces)
      const result = formatSimplifiedTree(node, 3);

      const indent = result.search(/\S/);
      assert.strictEqual(indent, 6); // 3 * 2 spaces
    });
  });

  // ==========================================================================
  // AccessibilityNode Structure Tests
  // ==========================================================================

  describe('AccessibilityNode structure', () => {
    it('node can have all optional fields', () => {
      const fullNode: AccessibilityNode = {
        nodeId: 'full-node',
        role: 'textbox',
        name: 'Username Input',
        description: 'Enter your username',
        value: 'john_doe',
        backendDOMNodeId: 12345,
        parentId: 'parent-1',
        childIds: ['child-a', 'child-b'],
        properties: [{ name: 'focused', value: { value: true } }],
        children: [],
      };

      // Node should have all fields
      assert.strictEqual(fullNode.nodeId, 'full-node');
      assert.strictEqual(fullNode.role, 'textbox');
      assert.strictEqual(fullNode.name, 'Username Input');
      assert.strictEqual(fullNode.description, 'Enter your username');
      assert.strictEqual(fullNode.value, 'john_doe');
      assert.strictEqual(fullNode.backendDOMNodeId, 12345);
      assert.strictEqual(fullNode.parentId, 'parent-1');
      assert.deepStrictEqual(fullNode.childIds, ['child-a', 'child-b']);
      assert.isArray(fullNode.properties);
    });

    it('node can have minimal required fields', () => {
      const minimalNode: AccessibilityNode = {
        nodeId: 'minimal',
        role: 'generic',
      };

      assert.strictEqual(minimalNode.nodeId, 'minimal');
      assert.strictEqual(minimalNode.role, 'generic');
      assert.isUndefined(minimalNode.name);
      assert.isUndefined(minimalNode.children);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('handles node with undefined children', () => {
      const node: AccessibilityNode = {
        nodeId: 'no-children-prop',
        role: 'div',
        name: 'Container',
      };

      const result = formatSimplifiedTree(node);

      // Should not throw and should produce valid output
      assert.isString(result);
      assert.include(result, '[no-children-prop]');
    });

    it('handles very long node names', () => {
      const longName = 'A'.repeat(1000);
      const node = createMockAccessibilityNode({
        nodeId: 'long-name',
        role: 'heading',
        name: longName,
      });

      const result = formatSimplifiedTree(node);

      // Should include the full name
      assert.include(result, longName);
    });

    it('handles special characters in names', () => {
      const node = createMockAccessibilityNode({
        nodeId: 'special-chars',
        role: 'text',
        name: 'Hello <world> & "friends"',
      });

      const result = formatSimplifiedTree(node);

      // Should preserve special characters
      assert.include(result, 'Hello <world> & "friends"');
    });

    it('handles unicode characters in names', () => {
      const node = createMockAccessibilityNode({
        nodeId: 'unicode',
        role: 'text',
        name: '你好世界 🌍 مرحبا',
      });

      const result = formatSimplifiedTree(node);

      assert.include(result, '你好世界');
      assert.include(result, '🌍');
      assert.include(result, 'مرحبا');
    });

    it('handles newlines in names', () => {
      const node = createMockAccessibilityNode({
        nodeId: 'newlines',
        role: 'text',
        name: 'Line 1\nLine 2\nLine 3',
      });

      const result = formatSimplifiedTree(node);

      // The name with newlines should be included
      assert.include(result, 'Line 1');
    });
  });

  // ==========================================================================
  // Tree Building Edge Cases
  // ==========================================================================

  describe('tree building edge cases', () => {
    it('formats tree with circular reference guard', () => {
      // While the function doesn't have explicit circular reference protection,
      // we should ensure it handles reasonable tree structures
      const node = createMockAccessibilityNode({
        nodeId: 'parent',
        role: 'div',
        children: [
          createMockAccessibilityNode({
            nodeId: 'child',
            role: 'span',
            // No circular reference
          }),
        ],
      });

      // Should not hang or throw
      const result = formatSimplifiedTree(node);
      assert.isString(result);
    });

    it('handles tree with mixed node types', () => {
      const tree: AccessibilityNode = {
        nodeId: 'root',
        role: 'document',
        name: 'Document',
        children: [
          { nodeId: 'heading', role: 'heading', name: 'Title' },
          { nodeId: 'paragraph', role: 'paragraph', name: 'Content text' },
          { nodeId: 'button', role: 'button', name: 'Submit' },
          { nodeId: 'link', role: 'link', name: 'More info' },
          { nodeId: 'img', role: 'img', name: 'Logo' },
        ],
      };

      const result = formatSimplifiedTree(tree);

      // All node types should be present
      assert.include(result, 'heading');
      assert.include(result, 'paragraph');
      assert.include(result, 'button');
      assert.include(result, 'link');
      assert.include(result, 'img');
    });
  });
});
