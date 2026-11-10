// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Lit from '../../../../../ui/lit/lit.js';
import {renderToolResultMessage} from '../ToolResultMessage.js';
import {raf} from '../../../../../testing/DOMHelpers.js';
import {ChatMessageEntity} from '../../../models/ChatTypes.js';
import type {ToolResultMessage} from '../../../models/ChatTypes.js';

const {render} = Lit;

describe('ToolResultMessage Renderer', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function createToolResult(toolName: string, resultText: string, options?: Partial<ToolResultMessage>): ToolResultMessage {
    return {
      entity: ChatMessageEntity.TOOL_RESULT,
      toolName,
      resultText,
      isError: false,
      ...options,
    };
  }

  function renderToContainer(msg: ToolResultMessage): void {
    render(renderToolResultMessage(msg), container);
  }

  describe('Successful Tool Results', () => {
    it('renders successful tool result', async () => {
      const msg = createToolResult('fetch', '{"data": "ok"}');
      renderToContainer(msg);
      await raf();

      const messageEl = container.querySelector('.message.tool-result-message');
      assert.isNotNull(messageEl, 'Should render tool-result-message element');
      assert.isFalse(messageEl!.classList.contains('error'), 'Should not have error class');
    });

    it('displays tool name', async () => {
      const msg = createToolResult('web_search', 'Results found');
      renderToContainer(msg);
      await raf();

      const toolNameEl = container.querySelector('.tool-name-display');
      assert.isNotNull(toolNameEl);
      assert.include(toolNameEl!.textContent, 'web_search');
      assert.include(toolNameEl!.textContent, 'Result from:');
    });

    it('displays result text', async () => {
      const msg = createToolResult('analyze', 'Analysis complete: 5 issues found');
      renderToContainer(msg);
      await raf();

      const resultEl = container.querySelector('.tool-result-raw');
      assert.isNotNull(resultEl);
      assert.include(resultEl!.textContent, 'Analysis complete: 5 issues found');
    });

    it('handles JSON result formatting', async () => {
      const jsonResult = JSON.stringify({ status: 'ok', items: [1, 2, 3] });
      const msg = createToolResult('api_call', jsonResult);
      renderToContainer(msg);
      await raf();

      const resultEl = container.querySelector('.tool-result-raw');
      assert.isNotNull(resultEl);
      assert.include(resultEl!.textContent, '"status"');
      assert.include(resultEl!.textContent, '"items"');
    });
  });

  describe('Error Tool Results', () => {
    it('renders error tool result with error class', async () => {
      const msg = createToolResult('fetch', 'Network timeout', { isError: true });
      renderToContainer(msg);
      await raf();

      const messageEl = container.querySelector('.message.tool-result-message');
      assert.isNotNull(messageEl);
      assert.isTrue(messageEl!.classList.contains('error'), 'Should have error class');
    });

    it('shows (Error) indicator in tool name for error results', async () => {
      const msg = createToolResult('fetch', 'Connection refused', { isError: true });
      renderToContainer(msg);
      await raf();

      const toolNameEl = container.querySelector('.tool-name-display');
      assert.isNotNull(toolNameEl);
      assert.include(toolNameEl!.textContent, '(Error)');
    });

    it('does not show (Error) indicator for successful results', async () => {
      const msg = createToolResult('fetch', 'Success');
      renderToContainer(msg);
      await raf();

      const toolNameEl = container.querySelector('.tool-name-display');
      assert.isNotNull(toolNameEl);
      assert.notInclude(toolNameEl!.textContent, '(Error)');
    });

    it('displays error message when error field is present', async () => {
      const msg = createToolResult('api_call', 'Failed', {
        isError: true,
        error: 'Authentication required',
      });
      renderToContainer(msg);
      await raf();

      const errorEl = container.querySelector('.message-error');
      assert.isNotNull(errorEl);
      assert.include(errorEl!.textContent, 'Authentication required');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty result text', async () => {
      const msg = createToolResult('check', '');
      renderToContainer(msg);
      await raf();

      const messageEl = container.querySelector('.message.tool-result-message');
      assert.isNotNull(messageEl, 'Should render even with empty result');
    });

    it('handles very large result text', async () => {
      const largeResult = 'X'.repeat(50000);
      const msg = createToolResult('dump', largeResult);

      const startTime = Date.now();
      renderToContainer(msg);
      await raf();
      const duration = Date.now() - startTime;

      const resultEl = container.querySelector('.tool-result-raw');
      assert.isNotNull(resultEl);
      assert.isBelow(duration, 2000, 'Should handle large results quickly');
    });

    it('handles special characters in result text', async () => {
      const msg = createToolResult('execute', '<script>alert(1)</script>');
      renderToContainer(msg);
      await raf();

      const resultEl = container.querySelector('.tool-result-raw');
      assert.isNotNull(resultEl);
      // Content should be displayed safely (as text, not executed)
      assert.include(resultEl!.textContent, '<script>');
    });

    it('handles binary-like content in result', async () => {
      const binaryLike = 'PNG\x89\x50\x4E\x47\x0D\x0A\x1A\x0A';
      const msg = createToolResult('screenshot', `[Binary data: ${binaryLike}]`);
      renderToContainer(msg);
      await raf();

      const resultEl = container.querySelector('.tool-result-raw');
      assert.isNotNull(resultEl, 'Should render without crashing');
    });

    it('handles multiline result text', async () => {
      const multilineResult = `Line 1
Line 2
Line 3`;
      const msg = createToolResult('log', multilineResult);
      renderToContainer(msg);
      await raf();

      const resultEl = container.querySelector('.tool-result-raw');
      assert.isNotNull(resultEl);
      assert.include(resultEl!.textContent, 'Line 1');
      assert.include(resultEl!.textContent, 'Line 2');
      assert.include(resultEl!.textContent, 'Line 3');
    });

    it('handles circular JSON references gracefully', async () => {
      // Simulate what would happen if circular JSON was stringified with a replacer
      const msg = createToolResult('parse', '[Circular reference detected]');
      renderToContainer(msg);
      await raf();

      const resultEl = container.querySelector('.tool-result-raw');
      assert.isNotNull(resultEl);
      assert.include(resultEl!.textContent, 'Circular reference');
    });
  });

  describe('Tool Status', () => {
    it('renders completed status class', async () => {
      const msg = createToolResult('check', 'Done');
      renderToContainer(msg);
      await raf();

      const statusEl = container.querySelector('.tool-status.completed');
      assert.isNotNull(statusEl, 'Should have completed status class');
    });
  });
});
