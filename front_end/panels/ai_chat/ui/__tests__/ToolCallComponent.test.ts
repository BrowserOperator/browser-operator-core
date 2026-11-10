// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import '../ToolCallComponent.js';
import {raf} from '../../../../testing/DOMHelpers.js';
import type {ToolCallComponent, ToolStatus} from '../ToolCallComponent.js';

type AgentMessage = {
  id: string;
  timestamp: Date;
  type: string;
  content: any;
};

function makeToolCall(toolName: string, toolArgs: Record<string, any> = {}, id = 'test-id'): AgentMessage {
  return {
    id,
    timestamp: new Date(),
    type: 'tool_call',
    content: {
      type: 'tool_call',
      toolName,
      toolArgs,
      toolCallId: id,
    },
  };
}

describe('ToolCallComponent', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function createComponent(): ToolCallComponent {
    const el = document.createElement('tool-call') as ToolCallComponent;
    container.appendChild(el);
    return el;
  }

  function getShadowRoot(el: ToolCallComponent): ShadowRoot {
    return el.shadowRoot!;
  }

  describe('Basic Rendering', () => {
    it('renders empty when no tool call set', async () => {
      const el = createComponent();
      await raf();

      const sroot = getShadowRoot(el);
      const toolDiv = sroot.querySelector('.enterprise-tool');
      assert.isNull(toolDiv, 'Should not render without tool call');
    });

    it('renders tool call with name and status', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('fetch_url', {url: 'https://example.com'}));
      await raf();

      const sroot = getShadowRoot(el);
      const toolDiv = sroot.querySelector('.enterprise-tool');
      assert.isNotNull(toolDiv);

      const toolName = sroot.querySelector('.tool-name');
      assert.isNotNull(toolName);
      assert.include(toolName!.textContent, 'fetch url');
    });

    it('displays correct icon based on tool name', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('search_web', {query: 'test'}));
      await raf();

      const sroot = getShadowRoot(el);
      const toolName = sroot.querySelector('.tool-name');
      assert.include(toolName!.textContent, '🔍');
    });

    it('displays browse icon for navigation tools', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('navigate_to', {url: 'https://example.com'}));
      await raf();

      const sroot = getShadowRoot(el);
      const toolName = sroot.querySelector('.tool-name');
      assert.include(toolName!.textContent, '🌐');
    });
  });

  describe('Status Management', () => {
    it('starts with running status by default', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('fetch_url', {}));
      await raf();

      const sroot = getShadowRoot(el);
      const toolDiv = sroot.querySelector('.enterprise-tool');
      assert.isTrue(toolDiv!.classList.contains('running'));

      const statusBadge = sroot.querySelector('.tool-status');
      assert.include(statusBadge!.textContent, 'Running');
      assert.include(statusBadge!.textContent, '⏳');
    });

    it('updates to completed status', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('fetch_url', {}));
      await raf();

      el.updateStatus('completed');
      await raf();

      const sroot = getShadowRoot(el);
      const toolDiv = sroot.querySelector('.enterprise-tool');
      assert.isTrue(toolDiv!.classList.contains('completed'));

      const statusBadge = sroot.querySelector('.tool-status');
      assert.include(statusBadge!.textContent, 'Success');
      assert.include(statusBadge!.textContent, '✓');
    });

    it('updates to error status', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('fetch_url', {}));
      await raf();

      el.updateStatus('error');
      await raf();

      const sroot = getShadowRoot(el);
      const toolDiv = sroot.querySelector('.enterprise-tool');
      assert.isTrue(toolDiv!.classList.contains('error'));

      const statusBadge = sroot.querySelector('.tool-status');
      assert.include(statusBadge!.textContent, 'Error');
      assert.include(statusBadge!.textContent, '❌');
    });

    it('resets status when setting new tool call', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('fetch_url', {}));
      el.updateStatus('completed');
      await raf();

      el.setToolCall(makeToolCall('new_tool', {}));
      await raf();

      const sroot = getShadowRoot(el);
      const toolDiv = sroot.querySelector('.enterprise-tool');
      assert.isTrue(toolDiv!.classList.contains('running'));
    });
  });

  describe('Expand/Collapse', () => {
    it('is expanded by default', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('fetch_url', {url: 'https://example.com'}));
      await raf();

      const sroot = getShadowRoot(el);
      const details = sroot.querySelector('.tool-details');
      assert.isNotNull(details, 'Details should be visible when expanded');

      const expandIcon = sroot.querySelector('.expand-icon');
      assert.isTrue(expandIcon!.classList.contains('expanded'));
    });

    it('collapses on header click', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('fetch_url', {url: 'https://example.com'}));
      await raf();

      const sroot = getShadowRoot(el);
      const header = sroot.querySelector('.tool-header') as HTMLElement;
      header.click();
      await raf();

      const details = getShadowRoot(el).querySelector('.tool-details');
      assert.isNull(details, 'Details should be hidden when collapsed');

      const expandIcon = getShadowRoot(el).querySelector('.expand-icon');
      assert.isFalse(expandIcon!.classList.contains('expanded'));
    });

    it('toggles back to expanded on second click', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('fetch_url', {url: 'https://example.com'}));
      await raf();

      const sroot = getShadowRoot(el);
      const header = sroot.querySelector('.tool-header') as HTMLElement;

      // Collapse
      header.click();
      await raf();

      // Expand
      header.click();
      await raf();

      const details = getShadowRoot(el).querySelector('.tool-details');
      assert.isNotNull(details, 'Details should be visible after re-expanding');
    });
  });

  describe('Tool Arguments Display', () => {
    it('displays single argument inline', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('fetch_url', {url: 'https://example.com'}));
      await raf();

      const sroot = getShadowRoot(el);
      const description = sroot.querySelector('.tool-description');
      assert.isNotNull(description);
      assert.include(description!.textContent, 'https://example.com');
    });

    it('displays multiple arguments as structured list', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('search_web', {
        query: 'test search',
        limit: 10,
        filter: 'recent',
      }));
      await raf();

      const sroot = getShadowRoot(el);
      const description = sroot.querySelector('.tool-description');
      assert.isTrue(description!.classList.contains('multiline'));

      const args = sroot.querySelectorAll('.tool-arg');
      assert.isAtLeast(args.length, 2);
    });

    it('filters out metadata fields from display', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('fetch_url', {
        url: 'https://example.com',
        reasoning: 'Need to fetch this URL',
        toolCallId: 'some-id',
        timestamp: '2025-01-01',
      }));
      await raf();

      const sroot = getShadowRoot(el);
      const details = sroot.querySelector('.tool-details');
      const detailsText = details!.textContent || '';

      assert.include(detailsText, 'url');
      assert.notInclude(detailsText, 'reasoning');
      assert.notInclude(detailsText, 'toolCallId');
      assert.notInclude(detailsText, 'timestamp');
    });

    it('shows JSON in details panel', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('fetch_url', {url: 'https://example.com', headers: {auth: 'token'}}));
      await raf();

      const sroot = getShadowRoot(el);
      const details = sroot.querySelector('.tool-details');
      assert.isNotNull(details);

      // Should contain formatted JSON
      const text = details!.textContent || '';
      assert.include(text, 'url');
      assert.include(text, 'https://example.com');
    });
  });

  describe('Tool Icon Mapping', () => {
    const iconTests: Array<{toolName: string; expectedIcon: string}> = [
      {toolName: 'search_content', expectedIcon: '🔍'},
      {toolName: 'browse_page', expectedIcon: '🌐'},
      {toolName: 'navigate_to', expectedIcon: '🌐'},
      {toolName: 'create_file', expectedIcon: '📝'},
      {toolName: 'write_content', expectedIcon: '📝'},
      {toolName: 'extract_data', expectedIcon: '🔬'},
      {toolName: 'analyze_page', expectedIcon: '🔬'},
      {toolName: 'click_element', expectedIcon: '👆'},
      {toolName: 'take_screenshot', expectedIcon: '📸'},
      {toolName: 'get_accessibility_tree', expectedIcon: '🌳'},
      {toolName: 'sequential_thinking', expectedIcon: '🧠'},
      {toolName: 'fetch_resource', expectedIcon: '📥'},
      {toolName: 'download_file', expectedIcon: '📥'},
      {toolName: 'scroll_page', expectedIcon: '📜'},
      {toolName: 'type_text', expectedIcon: '⌨️'},
      {toolName: 'unknown_tool', expectedIcon: '🔧'},
    ];

    for (const {toolName, expectedIcon} of iconTests) {
      it(`shows ${expectedIcon} icon for ${toolName}`, async () => {
        const el = createComponent();
        el.setToolCall(makeToolCall(toolName, {}));
        await raf();

        const sroot = getShadowRoot(el);
        const toolNameEl = sroot.querySelector('.tool-name');
        assert.include(toolNameEl!.textContent, expectedIcon);
      });
    }
  });

  describe('Edge Cases', () => {
    it('handles empty tool arguments', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('simple_tool', {}));
      await raf();

      const sroot = getShadowRoot(el);
      const toolDiv = sroot.querySelector('.enterprise-tool');
      assert.isNotNull(toolDiv);
    });

    it('handles missing toolArgs in content', async () => {
      const el = createComponent();
      el.setToolCall({
        id: 'test',
        timestamp: new Date(),
        type: 'tool_call',
        content: {
          type: 'tool_call',
          toolName: 'test_tool',
          // No toolArgs
        },
      });
      await raf();

      const sroot = getShadowRoot(el);
      const toolDiv = sroot.querySelector('.enterprise-tool');
      assert.isNotNull(toolDiv);
    });

    it('handles unknown tool name gracefully', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('completely_unknown_operation', {data: 'test'}));
      await raf();

      const sroot = getShadowRoot(el);
      const toolName = sroot.querySelector('.tool-name');
      assert.include(toolName!.textContent, 'completely unknown operation');
      assert.include(toolName!.textContent, '🔧');
    });

    it('handles deeply nested arguments', async () => {
      const el = createComponent();
      el.setToolCall(makeToolCall('complex_tool', {
        nested: {
          level1: {
            level2: {
              value: 'deep',
            },
          },
        },
      }));
      await raf();

      const sroot = getShadowRoot(el);
      const details = sroot.querySelector('.tool-details');
      const text = details!.textContent || '';
      assert.include(text, 'nested');
    });
  });
});
