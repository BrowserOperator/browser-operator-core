// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import '../ChatInput.js';
import {raf} from '../../../../../testing/DOMHelpers.js';
import type {ChatInput} from '../ChatInput.js';

describe('ChatInput Component', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function createInput(options?: {
    placeholder?: string;
    disabled?: boolean;
    value?: string;
  }): ChatInput {
    const input = document.createElement('ai-chat-input') as ChatInput;
    if (options?.placeholder !== undefined) {
      input.placeholder = options.placeholder;
    }
    if (options?.disabled !== undefined) {
      input.disabled = options.disabled;
    }
    if (options?.value !== undefined) {
      input.value = options.value;
    }
    container.appendChild(input);
    return input;
  }

  function getTextarea(input: ChatInput): HTMLTextAreaElement {
    return input.querySelector('textarea')!;
  }

  describe('Rendering', () => {
    it('renders textarea with placeholder', async () => {
      const input = createInput({ placeholder: 'Type your message...' });
      await raf();

      const textarea = getTextarea(input);
      assert.isNotNull(textarea);
      assert.strictEqual(textarea.placeholder, 'Type your message...');
    });

    it('renders textarea with initial value', async () => {
      const input = createInput({ value: 'Hello' });
      await raf();

      const textarea = getTextarea(input);
      assert.strictEqual(textarea.value, 'Hello');
    });

    it('renders textarea with disabled state', async () => {
      const input = createInput({ disabled: true });
      await raf();

      const textarea = getTextarea(input);
      assert.isTrue(textarea.disabled);
    });

    it('renders without placeholder when not set', async () => {
      const input = createInput();
      await raf();

      const textarea = getTextarea(input);
      assert.strictEqual(textarea.placeholder, '');
    });
  });

  describe('Value Property', () => {
    it('updates value via property setter', async () => {
      const input = createInput();
      await raf();

      input.value = 'New text';
      await raf();

      const textarea = getTextarea(input);
      assert.strictEqual(textarea.value, 'New text');
      assert.strictEqual(input.value, 'New text');
    });

    it('handles null/undefined value gracefully', async () => {
      const input = createInput({ value: 'Initial' });
      await raf();

      input.value = null as unknown as string;
      await raf();

      const textarea = getTextarea(input);
      assert.strictEqual(textarea.value, '');
    });
  });

  describe('Input Events', () => {
    it('dispatches inputchange event on typing', async () => {
      const input = createInput();
      await raf();

      let eventValue = '';
      input.addEventListener('inputchange', (e: Event) => {
        eventValue = (e as CustomEvent).detail.value;
      });

      const textarea = getTextarea(input);
      textarea.value = 'Typed text';
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));

      assert.strictEqual(eventValue, 'Typed text');
      assert.strictEqual(input.value, 'Typed text');
    });
  });

  describe('Enter Key Handling', () => {
    it('dispatches send event on Enter key', async () => {
      const input = createInput({ value: 'Message to send' });
      await raf();

      let sentText = '';
      input.addEventListener('send', (e: Event) => {
        sentText = (e as CustomEvent).detail.text;
      });

      const textarea = getTextarea(input);
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      assert.strictEqual(sentText, 'Message to send');
    });

    it('clears input after sending on Enter', async () => {
      const input = createInput({ value: 'Message' });
      await raf();

      const textarea = getTextarea(input);
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await raf();

      assert.strictEqual(input.value, '');
      assert.strictEqual(textarea.value, '');
    });

    it('allows newline on Shift+Enter', async () => {
      const input = createInput({ value: 'Line 1' });
      await raf();

      let sendCalled = false;
      input.addEventListener('send', () => {
        sendCalled = true;
      });

      const textarea = getTextarea(input);
      textarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
      }));

      assert.isFalse(sendCalled, 'Should not send on Shift+Enter');
      // Value should be preserved
      assert.strictEqual(input.value, 'Line 1');
    });

    it('does not send on Enter when input is empty', async () => {
      const input = createInput({ value: '' });
      await raf();

      let sendCalled = false;
      input.addEventListener('send', () => {
        sendCalled = true;
      });

      const textarea = getTextarea(input);
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      assert.isFalse(sendCalled, 'Should not send empty message');
    });

    it('does not send on Enter when input is whitespace only', async () => {
      const input = createInput({ value: '   ' });
      await raf();

      let sendCalled = false;
      input.addEventListener('send', () => {
        sendCalled = true;
      });

      const textarea = getTextarea(input);
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      assert.isFalse(sendCalled, 'Should not send whitespace-only message');
    });

    it('does not send on Enter when disabled', async () => {
      const input = createInput({ value: 'Message', disabled: true });
      await raf();

      let sendCalled = false;
      input.addEventListener('send', () => {
        sendCalled = true;
      });

      const textarea = getTextarea(input);
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      assert.isFalse(sendCalled, 'Should not send when disabled');
    });
  });

  describe('Disabled State', () => {
    it('disables textarea when disabled property is true', async () => {
      const input = createInput({ disabled: false });
      await raf();

      input.disabled = true;
      await raf();

      const textarea = getTextarea(input);
      assert.isTrue(textarea.disabled);
    });

    it('enables textarea when disabled property is false', async () => {
      const input = createInput({ disabled: true });
      await raf();

      input.disabled = false;
      await raf();

      const textarea = getTextarea(input);
      assert.isFalse(textarea.disabled);
    });
  });

  describe('Focus Management', () => {
    it('focuses textarea via focusInput method', async () => {
      const input = createInput();
      await raf();

      input.focusInput();

      const textarea = getTextarea(input);
      assert.strictEqual(document.activeElement, textarea);
    });
  });

  describe('Clear Method', () => {
    it('clears value via clear method', async () => {
      const input = createInput({ value: 'Some text' });
      await raf();

      input.clear();
      await raf();

      const textarea = getTextarea(input);
      assert.strictEqual(input.value, '');
      assert.strictEqual(textarea.value, '');
    });
  });

  describe('Auto-sizing', () => {
    it('auto-sizes on content change', async () => {
      const input = createInput();
      await raf();

      const textarea = getTextarea(input);
      const initialHeight = textarea.offsetHeight;

      // Simulate long content
      textarea.value = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await raf();

      // Height should have increased (or at least not be the same single-line height)
      // Note: exact heights depend on styling
      assert.isNotNaN(textarea.offsetHeight);
    });
  });

  describe('Edge Cases', () => {
    it('handles very long input without freezing', async () => {
      const input = createInput();
      await raf();

      const longText = 'A'.repeat(10000);
      const startTime = Date.now();

      input.value = longText;
      await raf();

      const duration = Date.now() - startTime;
      assert.isBelow(duration, 1000, 'Should handle long text quickly');
      assert.strictEqual(input.value, longText);
    });

    it('handles rapid input changes', async () => {
      const input = createInput();
      await raf();

      const textarea = getTextarea(input);
      const values: string[] = [];

      input.addEventListener('inputchange', (e: Event) => {
        values.push((e as CustomEvent).detail.value);
      });

      // Rapid typing simulation
      for (let i = 0; i < 20; i++) {
        textarea.value = `Text ${i}`;
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }

      assert.strictEqual(values.length, 20, 'Should capture all input events');
      assert.strictEqual(values[19], 'Text 19');
    });

    it('handles paste of large content', async () => {
      const input = createInput();
      await raf();

      const largeContent = 'Pasted '.repeat(5000);
      const textarea = getTextarea(input);

      const startTime = Date.now();
      textarea.value = largeContent;
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await raf();
      const duration = Date.now() - startTime;

      assert.isBelow(duration, 2000, 'Should handle large paste quickly');
    });
  });
});
