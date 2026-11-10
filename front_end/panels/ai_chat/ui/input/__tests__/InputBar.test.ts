// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import '../InputBar.js';
import '../ChatInput.js';
import '../../model_selector/ModelSelector.js';
import {raf} from '../../../../../testing/DOMHelpers.js';
import type {InputBar} from '../InputBar.js';

describe('InputBar Component', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function createInputBar(options?: {
    placeholder?: string;
    disabled?: boolean;
    sendDisabled?: boolean;
    modelOptions?: Array<{value: string; label: string}>;
    selectedModel?: string;
    modelSelectorDisabled?: boolean;
    currentProvider?: string;
    centered?: boolean;
    imageInput?: { url: string; bytesBase64: string };
  }): InputBar {
    const bar = document.createElement('ai-input-bar') as InputBar;
    if (options?.placeholder !== undefined) {
      (bar as any).placeholder = options.placeholder;
    }
    if (options?.disabled !== undefined) {
      (bar as any).disabled = options.disabled;
    }
    if (options?.sendDisabled !== undefined) {
      (bar as any).sendDisabled = options.sendDisabled;
    }
    if (options?.modelOptions !== undefined) {
      (bar as any).modelOptions = options.modelOptions;
    }
    if (options?.selectedModel !== undefined) {
      (bar as any).selectedModel = options.selectedModel;
    }
    if (options?.modelSelectorDisabled !== undefined) {
      (bar as any).modelSelectorDisabled = options.modelSelectorDisabled;
    }
    if (options?.currentProvider !== undefined) {
      (bar as any).currentProvider = options.currentProvider;
    }
    if (options?.centered !== undefined) {
      (bar as any).centered = options.centered;
    }
    if (options?.imageInput !== undefined) {
      (bar as any).imageInput = options.imageInput;
    }
    container.appendChild(bar);
    return bar;
  }

  function getTextarea(bar: InputBar): HTMLTextAreaElement {
    const chatInput = bar.querySelector('ai-chat-input');
    return chatInput?.querySelector('textarea') as HTMLTextAreaElement;
  }

  function getSendButton(bar: InputBar): HTMLButtonElement {
    return bar.querySelector('.send-button') as HTMLButtonElement;
  }

  function getModelSelector(bar: InputBar): HTMLElement | null {
    return bar.querySelector('ai-model-selector');
  }

  describe('Rendering', () => {
    it('renders in centered mode', async () => {
      const bar = createInputBar({ centered: true });
      await raf();

      const inputContainer = bar.querySelector('.input-container');
      assert.isNotNull(inputContainer);
      assert.isTrue(inputContainer!.classList.contains('centered'));
    });

    it('renders in expanded mode', async () => {
      const bar = createInputBar({ centered: false });
      await raf();

      const inputContainer = bar.querySelector('.input-container');
      assert.isNotNull(inputContainer);
      assert.isFalse(inputContainer!.classList.contains('centered'));
    });

    it('renders chat input component', async () => {
      const bar = createInputBar({ placeholder: 'Type here...' });
      await raf();

      const chatInput = bar.querySelector('ai-chat-input');
      assert.isNotNull(chatInput);
    });

    it('renders send button', async () => {
      const bar = createInputBar();
      await raf();

      const sendBtn = getSendButton(bar);
      assert.isNotNull(sendBtn);
      assert.strictEqual(sendBtn.getAttribute('title'), 'Send message');
    });
  });

  describe('Text Input Handling', () => {
    it('handles text input changes', async () => {
      const bar = createInputBar();
      await raf();

      let inputValue = '';
      bar.addEventListener('inputchange', (e: Event) => {
        inputValue = (e as CustomEvent).detail.value;
      });

      const textarea = getTextarea(bar);
      textarea.value = 'Hello';
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));

      assert.strictEqual(inputValue, 'Hello');
    });

    it('dispatches send event with text', async () => {
      const bar = createInputBar({ sendDisabled: false });
      await raf();

      let sentText = '';
      bar.addEventListener('send', (e: Event) => {
        sentText = (e as CustomEvent).detail.text;
      });

      const textarea = getTextarea(bar);
      textarea.value = 'Message to send';
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await raf();

      // Simulate Enter key
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      assert.strictEqual(sentText, 'Message to send');
    });
  });

  describe('Send Button', () => {
    it('send button is disabled when sendDisabled is true', async () => {
      const bar = createInputBar({ sendDisabled: true });
      await raf();

      const sendBtn = getSendButton(bar);
      assert.isTrue(sendBtn.disabled);
      assert.isTrue(sendBtn.classList.contains('disabled'));
    });

    it('send button is enabled when sendDisabled is false', async () => {
      const bar = createInputBar({ sendDisabled: false });
      await raf();

      const sendBtn = getSendButton(bar);
      assert.isFalse(sendBtn.disabled);
      assert.isFalse(sendBtn.classList.contains('disabled'));
    });

    it('clicking send button dispatches send event', async () => {
      const bar = createInputBar({ sendDisabled: false });
      await raf();

      let sendCalled = false;
      bar.addEventListener('send', () => {
        sendCalled = true;
      });

      const textarea = getTextarea(bar);
      textarea.value = 'Test';
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await raf();

      const sendBtn = getSendButton(bar);
      sendBtn.click();

      assert.isTrue(sendCalled);
    });

    it('clicking send button with empty input does not dispatch', async () => {
      const bar = createInputBar({ sendDisabled: false });
      await raf();

      let sendCalled = false;
      bar.addEventListener('send', () => {
        sendCalled = true;
      });

      const sendBtn = getSendButton(bar);
      sendBtn.click();

      assert.isFalse(sendCalled);
    });
  });

  describe('Disabled State', () => {
    it('disables all inputs when disabled is true', async () => {
      const bar = createInputBar({ disabled: true });
      await raf();

      const textarea = getTextarea(bar);
      assert.isTrue(textarea.disabled);
    });
  });

  describe('setInputValue API', () => {
    it('sets input value programmatically', async () => {
      const bar = createInputBar();
      await raf();

      bar.setInputValue('Programmatic text');
      await raf();

      const textarea = getTextarea(bar);
      assert.strictEqual(textarea.value, 'Programmatic text');
    });

    it('dispatches inputchange event when setting value', async () => {
      const bar = createInputBar();
      await raf();

      let inputValue = '';
      bar.addEventListener('inputchange', (e: Event) => {
        inputValue = (e as CustomEvent).detail.value;
      });

      bar.setInputValue('Test value');

      assert.strictEqual(inputValue, 'Test value');
    });

    it('handles null/undefined gracefully', async () => {
      const bar = createInputBar();
      await raf();

      bar.setInputValue(null as unknown as string);
      await raf();

      const textarea = getTextarea(bar);
      assert.strictEqual(textarea.value, '');
    });
  });

  describe('clearInput API', () => {
    it('clears input value', async () => {
      const bar = createInputBar();
      await raf();

      const textarea = getTextarea(bar);
      textarea.value = 'Some text';
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await raf();

      bar.clearInput();
      await raf();

      assert.strictEqual(textarea.value, '');
    });
  });

  describe('Image Input', () => {
    it('shows image preview when imageInput is set', async () => {
      const bar = createInputBar({
        imageInput: {
          url: 'data:image/png;base64,test',
          bytesBase64: 'test',
        },
      });
      await raf();

      const imagePreview = bar.querySelector('.image-preview');
      assert.isNotNull(imagePreview);

      const img = imagePreview!.querySelector('img');
      assert.isNotNull(img);
      assert.strictEqual(img!.src, 'data:image/png;base64,test');
    });

    it('does not show image preview when no imageInput', async () => {
      const bar = createInputBar();
      await raf();

      const imagePreview = bar.querySelector('.image-preview');
      assert.isNull(imagePreview);
    });

    it('dispatches image-clear event when remove button clicked', async () => {
      const bar = createInputBar({
        imageInput: {
          url: 'data:image/png;base64,test',
          bytesBase64: 'test',
        },
      });
      await raf();

      let clearCalled = false;
      bar.addEventListener('image-clear', () => {
        clearCalled = true;
      });

      const removeBtn = bar.querySelector('.image-remove-button') as HTMLButtonElement;
      removeBtn.click();

      assert.isTrue(clearCalled);
    });
  });

  describe('Model Selector', () => {
    it('renders model selector when modelOptions and selectedModel are set', async () => {
      const bar = createInputBar({
        modelOptions: [
          { value: 'gpt-4', label: 'GPT-4' },
          { value: 'gpt-3.5', label: 'GPT-3.5' },
        ],
        selectedModel: 'gpt-4',
        currentProvider: 'openai',
      });
      await raf();

      const selector = getModelSelector(bar);
      assert.isNotNull(selector);
    });

    it('does not render model selector when currentProvider is browseroperator', async () => {
      const bar = createInputBar({
        modelOptions: [
          { value: 'gpt-4', label: 'GPT-4' },
        ],
        selectedModel: 'gpt-4',
        currentProvider: 'browseroperator',
      });
      await raf();

      const selector = getModelSelector(bar);
      assert.isNull(selector);
    });

    it('does not render model selector when modelOptions is empty', async () => {
      const bar = createInputBar({
        modelOptions: [],
        selectedModel: 'gpt-4',
        currentProvider: 'openai',
      });
      await raf();

      const selector = getModelSelector(bar);
      assert.isNull(selector);
    });

    it('dispatches model-changed event when model is changed', async () => {
      const bar = createInputBar({
        modelOptions: [
          { value: 'gpt-4', label: 'GPT-4' },
          { value: 'gpt-3.5', label: 'GPT-3.5' },
        ],
        selectedModel: 'gpt-4',
        currentProvider: 'openai',
      });
      await raf();

      let changedValue = '';
      bar.addEventListener('model-changed', (e: Event) => {
        changedValue = (e as CustomEvent).detail.value;
      });

      const selector = getModelSelector(bar);
      selector!.dispatchEvent(new CustomEvent('change', {
        bubbles: true,
        detail: { value: 'gpt-3.5' },
      }));

      assert.strictEqual(changedValue, 'gpt-3.5');
    });
  });

  describe('Error Handling', () => {
    it('handles empty submit gracefully', async () => {
      const bar = createInputBar({ sendDisabled: false });
      await raf();

      let errorOccurred = false;
      try {
        const sendBtn = getSendButton(bar);
        sendBtn.click();
      } catch {
        errorOccurred = true;
      }

      assert.isFalse(errorOccurred);
    });

    it('handles very long input without freezing', async () => {
      const bar = createInputBar();
      await raf();

      const longText = 'A'.repeat(50000);
      const startTime = Date.now();

      bar.setInputValue(longText);
      await raf();

      const duration = Date.now() - startTime;
      assert.isBelow(duration, 2000, 'Should handle long input quickly');
    });
  });
});
