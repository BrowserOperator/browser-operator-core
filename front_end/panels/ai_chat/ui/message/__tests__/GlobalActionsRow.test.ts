// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Lit from '../../../../../ui/lit/lit.js';
import {renderGlobalActionsRow} from '../GlobalActionsRow.js';
import {raf} from '../../../../../testing/DOMHelpers.js';

const {render} = Lit;

describe('GlobalActionsRow Renderer', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function renderActions(options: {
    textToCopy?: string;
    onCopy?: () => void;
    onThumbsUp?: () => void;
    onThumbsDown?: () => void;
    onRetry?: () => void;
  }): void {
    render(renderGlobalActionsRow({
      textToCopy: options.textToCopy ?? 'Sample text to copy',
      onCopy: options.onCopy,
      onThumbsUp: options.onThumbsUp,
      onThumbsDown: options.onThumbsDown,
      onRetry: options.onRetry,
    }), container);
  }

  describe('Button Rendering', () => {
    it('renders copy button', async () => {
      renderActions({});
      await raf();

      const copyButton = container.querySelector('.message-action-button');
      assert.isNotNull(copyButton, 'Should render copy button');

      const tooltip = copyButton!.querySelector('.action-tooltip');
      assert.isNotNull(tooltip);
      assert.include(tooltip!.textContent, 'Copy');
    });

    it('renders thumbs up button', async () => {
      renderActions({});
      await raf();

      const thumbsUpButton = container.querySelector('.message-action-button.thumbs-up');
      assert.isNotNull(thumbsUpButton, 'Should render thumbs up button');
      assert.strictEqual(thumbsUpButton!.getAttribute('title'), 'Helpful');
    });

    it('renders thumbs down button', async () => {
      renderActions({});
      await raf();

      const thumbsDownButton = container.querySelector('.message-action-button.thumbs-down');
      assert.isNotNull(thumbsDownButton, 'Should render thumbs down button');
      assert.strictEqual(thumbsDownButton!.getAttribute('title'), 'Not helpful');
    });

    it('renders retry button', async () => {
      renderActions({});
      await raf();

      const retryButton = container.querySelector('.message-action-button.retry');
      assert.isNotNull(retryButton, 'Should render retry button');
      assert.strictEqual(retryButton!.getAttribute('title'), 'Regenerate response');
    });

    it('renders all four action buttons', async () => {
      renderActions({});
      await raf();

      const buttons = container.querySelectorAll('.message-action-button');
      assert.strictEqual(buttons.length, 4, 'Should render all four buttons');
    });

    it('renders container with correct class', async () => {
      renderActions({});
      await raf();

      const containerEl = container.querySelector('.global-actions-container');
      assert.isNotNull(containerEl, 'Should render container');

      const actionsRow = container.querySelector('.message-actions-row');
      assert.isNotNull(actionsRow, 'Should render actions row');
    });
  });

  describe('Button Click Handlers', () => {
    it('triggers onCopy callback when copy button is clicked', async () => {
      let copyClicked = false;
      renderActions({
        onCopy: () => { copyClicked = true; },
      });
      await raf();

      const copyButton = container.querySelector('.message-action-button') as HTMLButtonElement;
      copyButton.click();

      assert.isTrue(copyClicked, 'onCopy callback should be called');
    });

    it('triggers onThumbsUp callback when thumbs up is clicked', async () => {
      let thumbsUpClicked = false;
      renderActions({
        onThumbsUp: () => { thumbsUpClicked = true; },
      });
      await raf();

      const thumbsUpButton = container.querySelector('.message-action-button.thumbs-up') as HTMLButtonElement;
      thumbsUpButton.click();

      assert.isTrue(thumbsUpClicked, 'onThumbsUp callback should be called');
    });

    it('triggers onThumbsDown callback when thumbs down is clicked', async () => {
      let thumbsDownClicked = false;
      renderActions({
        onThumbsDown: () => { thumbsDownClicked = true; },
      });
      await raf();

      const thumbsDownButton = container.querySelector('.message-action-button.thumbs-down') as HTMLButtonElement;
      thumbsDownButton.click();

      assert.isTrue(thumbsDownClicked, 'onThumbsDown callback should be called');
    });

    it('triggers onRetry callback when retry is clicked', async () => {
      let retryClicked = false;
      renderActions({
        onRetry: () => { retryClicked = true; },
      });
      await raf();

      const retryButton = container.querySelector('.message-action-button.retry') as HTMLButtonElement;
      retryButton.click();

      assert.isTrue(retryClicked, 'onRetry callback should be called');
    });
  });

  describe('Callback Edge Cases', () => {
    it('handles missing onCopy callback gracefully', async () => {
      renderActions({
        onCopy: undefined,
      });
      await raf();

      const copyButton = container.querySelector('.message-action-button') as HTMLButtonElement;

      // Should not throw when clicked with undefined callback
      assert.doesNotThrow(() => {
        copyButton.click();
      });
    });

    it('handles missing onThumbsUp callback gracefully', async () => {
      renderActions({
        onThumbsUp: undefined,
      });
      await raf();

      const button = container.querySelector('.message-action-button.thumbs-up') as HTMLButtonElement;
      assert.doesNotThrow(() => {
        button.click();
      });
    });

    it('handles missing onThumbsDown callback gracefully', async () => {
      renderActions({
        onThumbsDown: undefined,
      });
      await raf();

      const button = container.querySelector('.message-action-button.thumbs-down') as HTMLButtonElement;
      assert.doesNotThrow(() => {
        button.click();
      });
    });

    it('handles missing onRetry callback gracefully', async () => {
      renderActions({
        onRetry: undefined,
      });
      await raf();

      const button = container.querySelector('.message-action-button.retry') as HTMLButtonElement;
      assert.doesNotThrow(() => {
        button.click();
      });
    });

    it('handles all callbacks being undefined', async () => {
      renderActions({
        onCopy: undefined,
        onThumbsUp: undefined,
        onThumbsDown: undefined,
        onRetry: undefined,
      });
      await raf();

      const buttons = container.querySelectorAll('.message-action-button');
      assert.doesNotThrow(() => {
        buttons.forEach(btn => (btn as HTMLButtonElement).click());
      });
    });
  });

  describe('Icon Rendering', () => {
    it('renders SVG icons for all buttons', async () => {
      renderActions({});
      await raf();

      const icons = container.querySelectorAll('.action-icon');
      assert.strictEqual(icons.length, 4, 'Should render icons for all buttons');

      // All icons should be SVG elements
      icons.forEach(icon => {
        assert.strictEqual(icon.tagName.toLowerCase(), 'svg');
      });
    });

    it('renders icons with correct dimensions', async () => {
      renderActions({});
      await raf();

      const icons = container.querySelectorAll('.action-icon');
      icons.forEach(icon => {
        assert.strictEqual(icon.getAttribute('width'), '16');
        assert.strictEqual(icon.getAttribute('height'), '16');
      });
    });
  });

  describe('Accessibility', () => {
    it('all buttons have title attributes for accessibility', async () => {
      renderActions({});
      await raf();

      const buttons = container.querySelectorAll('.message-action-button');
      buttons.forEach(button => {
        const title = button.getAttribute('title');
        assert.isNotNull(title, 'Button should have title attribute');
        assert.isNotEmpty(title, 'Title should not be empty');
      });
    });

    it('renders tooltips for all buttons', async () => {
      renderActions({});
      await raf();

      const tooltips = container.querySelectorAll('.action-tooltip');
      assert.strictEqual(tooltips.length, 4, 'Should render tooltips for all buttons');
    });
  });

  describe('Text to Copy', () => {
    it('accepts textToCopy parameter', async () => {
      const testText = 'This is the text to be copied';
      renderActions({ textToCopy: testText });
      await raf();

      // The textToCopy is passed to the callback, not displayed
      // We verify the component renders without issues
      const copyButton = container.querySelector('.message-action-button');
      assert.isNotNull(copyButton);
    });

    it('handles empty textToCopy', async () => {
      renderActions({ textToCopy: '' });
      await raf();

      const copyButton = container.querySelector('.message-action-button');
      assert.isNotNull(copyButton, 'Should render even with empty text');
    });

    it('handles very long textToCopy', async () => {
      const longText = 'A'.repeat(100000);
      renderActions({ textToCopy: longText });
      await raf();

      const copyButton = container.querySelector('.message-action-button');
      assert.isNotNull(copyButton, 'Should render with long text');
    });
  });
});
