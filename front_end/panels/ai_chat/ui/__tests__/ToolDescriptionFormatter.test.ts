// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {ToolDescriptionFormatter} from '../ToolDescriptionFormatter.js';

describe('ToolDescriptionFormatter', () => {
  describe('getToolIcon', () => {
    it('returns search icon for search tools', () => {
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('search_web'), '🔍');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('search_content'), '🔍');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('global_search'), '🔍');
    });

    it('returns browse icon for navigation tools', () => {
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('browse_page'), '🌐');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('navigate_to'), '🌐');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('browser_action'), '🌐');
    });

    it('returns write icon for create/write tools', () => {
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('create_file'), '📝');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('write_content'), '📝');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('create_document'), '📝');
    });

    it('returns analyze icon for extract/analyze tools', () => {
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('extract_data'), '🔬');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('analyze_page'), '🔬');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('deep_extract'), '🔬');
    });

    it('returns click icon for action tools', () => {
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('click_element'), '👆');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('action_button'), '👆');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('perform_click'), '👆');
    });

    it('returns screenshot icon for screenshot tools', () => {
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('take_screenshot'), '📸');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('screenshot_page'), '📸');
    });

    it('returns tree icon for accessibility tools', () => {
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('accessibility_scan'), '🌳');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('get_tree'), '🌳');
    });

    it('returns brain icon for thinking tools', () => {
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('thinking_step'), '🧠');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('sequential_reasoning'), '🧠');
    });

    it('returns download icon for fetch/download tools', () => {
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('fetch_resource'), '📥');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('download_file'), '📥');
    });

    it('returns scroll icon for scroll tools', () => {
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('scroll_page'), '📜');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('scroll_down'), '📜');
    });

    it('returns keyboard icon for type/input tools', () => {
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('type_text'), '⌨️');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('input_field'), '⌨️');
    });

    it('returns default wrench icon for unknown tools', () => {
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('unknown_tool'), '🔧');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon('random_action'), '🔧');
      assert.strictEqual(ToolDescriptionFormatter.getToolIcon(''), '🔧');
    });
  });

  describe('formatToolName', () => {
    it('replaces underscores with spaces', () => {
      assert.strictEqual(ToolDescriptionFormatter.formatToolName('search_web'), 'search web');
      assert.strictEqual(ToolDescriptionFormatter.formatToolName('fetch_url'), 'fetch url');
    });

    it('handles multiple underscores', () => {
      assert.strictEqual(
        ToolDescriptionFormatter.formatToolName('get_page_content'),
        'get page content',
      );
    });

    it('handles tool names without underscores', () => {
      assert.strictEqual(ToolDescriptionFormatter.formatToolName('search'), 'search');
    });

    it('handles empty string', () => {
      assert.strictEqual(ToolDescriptionFormatter.formatToolName(''), '');
    });
  });

  describe('getActionName', () => {
    it('returns lowercase action name', () => {
      assert.strictEqual(ToolDescriptionFormatter.getActionName('Search_Web'), 'search web');
      assert.strictEqual(ToolDescriptionFormatter.getActionName('FETCH_URL'), 'fetch url');
    });
  });

  describe('getToolDescription', () => {
    it('returns action only when no args', () => {
      const result = ToolDescriptionFormatter.getToolDescription('fetch_url', {});
      assert.isFalse(result.isMultiLine);
      assert.strictEqual(result.content, 'fetch url');
      assert.strictEqual(result.action, 'fetch url');
    });

    it('returns single-line for one argument', () => {
      const result = ToolDescriptionFormatter.getToolDescription('fetch_url', {url: 'https://example.com'});
      assert.isFalse(result.isMultiLine);
      assert.include(result.content as string, 'fetch url');
      assert.include(result.content as string, 'https://example.com');
    });

    it('returns multi-line for multiple arguments', () => {
      const result = ToolDescriptionFormatter.getToolDescription('search_web', {
        query: 'test search',
        limit: 10,
      });
      assert.isTrue(result.isMultiLine);
      assert.isArray(result.content);

      const content = result.content as Array<{key: string; value: string}>;
      assert.isAtLeast(content.length, 2);

      const keys = content.map(c => c.key);
      assert.include(keys, 'query');
      assert.include(keys, 'limit');
    });

    it('filters out metadata fields', () => {
      const result = ToolDescriptionFormatter.getToolDescription('fetch_url', {
        url: 'https://example.com',
        reasoning: 'Need to fetch this',
        toolCallId: 'id-123',
        timestamp: '2025-01-01',
      });

      // Should only have url, not the metadata fields
      if (result.isMultiLine) {
        const content = result.content as Array<{key: string; value: string}>;
        const keys = content.map(c => c.key);
        assert.notInclude(keys, 'reasoning');
        assert.notInclude(keys, 'toolCallId');
        assert.notInclude(keys, 'timestamp');
      } else {
        const content = result.content as string;
        assert.notInclude(content, 'reasoning');
        assert.notInclude(content, 'toolCallId');
        assert.notInclude(content, 'timestamp');
      }
    });

    it('sorts query first in multi-line output', () => {
      const result = ToolDescriptionFormatter.getToolDescription('search', {
        limit: 10,
        query: 'test',
        filter: 'recent',
      });
      assert.isTrue(result.isMultiLine);

      const content = result.content as Array<{key: string; value: string}>;
      assert.strictEqual(content[0].key, 'query');
    });
  });

  describe('filterMetadataFields', () => {
    it('removes reasoning field', () => {
      const result = ToolDescriptionFormatter.filterMetadataFields({
        url: 'https://example.com',
        reasoning: 'Some reasoning',
      });
      assert.notProperty(result, 'reasoning');
      assert.property(result, 'url');
    });

    it('removes toolCallId field', () => {
      const result = ToolDescriptionFormatter.filterMetadataFields({
        url: 'https://example.com',
        toolCallId: 'id-123',
      });
      assert.notProperty(result, 'toolCallId');
    });

    it('removes timestamp field', () => {
      const result = ToolDescriptionFormatter.filterMetadataFields({
        url: 'https://example.com',
        timestamp: '2025-01-01',
      });
      assert.notProperty(result, 'timestamp');
    });

    it('preserves other fields', () => {
      const result = ToolDescriptionFormatter.filterMetadataFields({
        url: 'https://example.com',
        query: 'test',
        limit: 10,
        reasoning: 'remove this',
      });
      assert.property(result, 'url');
      assert.property(result, 'query');
      assert.property(result, 'limit');
      assert.notProperty(result, 'reasoning');
    });

    it('handles empty object', () => {
      const result = ToolDescriptionFormatter.filterMetadataFields({});
      assert.deepEqual(result, {});
    });
  });

  describe('formatValueForDisplay', () => {
    it('formats primitive values as strings', () => {
      assert.strictEqual(ToolDescriptionFormatter.formatValueForDisplay('test'), 'test');
      assert.strictEqual(ToolDescriptionFormatter.formatValueForDisplay(123), '123');
      assert.strictEqual(ToolDescriptionFormatter.formatValueForDisplay(true), 'true');
      assert.strictEqual(ToolDescriptionFormatter.formatValueForDisplay(false), 'false');
    });

    it('formats null and undefined', () => {
      assert.strictEqual(ToolDescriptionFormatter.formatValueForDisplay(null), 'null');
      assert.strictEqual(ToolDescriptionFormatter.formatValueForDisplay(undefined), 'undefined');
    });

    it('formats empty array as []', () => {
      assert.strictEqual(ToolDescriptionFormatter.formatValueForDisplay([]), '[]');
    });

    it('formats single-element array as its element', () => {
      assert.strictEqual(ToolDescriptionFormatter.formatValueForDisplay(['single']), 'single');
    });

    it('formats multi-element array as bullet list', () => {
      const result = ToolDescriptionFormatter.formatValueForDisplay(['a', 'b', 'c']);
      assert.include(result, '- a');
      assert.include(result, '- b');
      assert.include(result, '- c');
    });

    it('formats empty object as {}', () => {
      assert.strictEqual(ToolDescriptionFormatter.formatValueForDisplay({}), '{}');
    });

    it('formats object with key-value pairs', () => {
      const result = ToolDescriptionFormatter.formatValueForDisplay({name: 'test', value: 123});
      assert.include(result, 'name: test');
      assert.include(result, 'value: 123');
    });

    it('handles nested objects', () => {
      const result = ToolDescriptionFormatter.formatValueForDisplay({
        outer: {inner: 'value'},
      });
      assert.include(result, 'outer');
      assert.include(result, 'inner');
      assert.include(result, 'value');
    });

    it('prevents infinite recursion with max depth', () => {
      // Create deeply nested object
      let obj: any = {value: 'deep'};
      for (let i = 0; i < 15; i++) {
        obj = {nested: obj};
      }

      const result = ToolDescriptionFormatter.formatValueForDisplay(obj);
      assert.include(result, '[Max depth reached]');
    });
  });

  describe('Edge Cases', () => {
    it('handles tool name with only underscores', () => {
      const result = ToolDescriptionFormatter.formatToolName('___');
      assert.strictEqual(result, '   ');
    });

    it('handles args with only metadata fields', () => {
      const result = ToolDescriptionFormatter.getToolDescription('fetch', {
        reasoning: 'remove',
        toolCallId: 'remove',
        timestamp: 'remove',
      });
      assert.isFalse(result.isMultiLine);
      assert.strictEqual(result.content, 'fetch');
    });

    it('handles special characters in values', () => {
      const result = ToolDescriptionFormatter.formatValueForDisplay({
        html: '<script>alert("xss")</script>',
        unicode: '🎉',
      });
      assert.include(result, '<script>');
      assert.include(result, '🎉');
    });

    it('handles very long values', () => {
      const longValue = 'A'.repeat(1000);
      const result = ToolDescriptionFormatter.formatValueForDisplay(longValue);
      assert.strictEqual(result.length, 1000);
    });

    it('handles circular references gracefully', () => {
      // Note: This test verifies the depth limit prevents stack overflow
      const obj: any = {a: 1};
      // Can't actually create circular ref in formatValueForDisplay input
      // but we test depth limiting which serves same purpose
      let nested: any = {value: 'end'};
      for (let i = 0; i < 12; i++) {
        nested = {level: nested};
      }

      const result = ToolDescriptionFormatter.formatValueForDisplay(nested);
      // Should not throw and should contain max depth message
      assert.include(result, '[Max depth reached]');
    });
  });
});
