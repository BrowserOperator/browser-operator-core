// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Lit from '../../../../../ui/lit/lit.js';
import {renderModelMessage} from '../ModelMessage.js';
import {raf} from '../../../../../testing/DOMHelpers.js';
import {ChatMessageEntity} from '../../../models/ChatTypes.js';
import type {ModelChatMessage} from '../../../models/ChatTypes.js';

const {render} = Lit;

describe('ModelMessage Renderer', () => {
  let container: HTMLDivElement;
  let mockRenderer: any;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    // Simple mock markdown renderer
    mockRenderer = {
      renderMarkdown: (text: string) => text,
    };
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function createFinalMessage(answer: string, options?: Partial<ModelChatMessage>): ModelChatMessage {
    return {
      entity: ChatMessageEntity.MODEL,
      action: 'final',
      answer,
      isFinalAnswer: true,
      ...options,
    };
  }

  function createToolMessage(toolName: string, options?: Partial<ModelChatMessage>): ModelChatMessage {
    return {
      entity: ChatMessageEntity.MODEL,
      action: 'tool',
      toolName,
      toolArgs: {},
      isFinalAnswer: false,
      ...options,
    };
  }

  function renderToContainer(msg: ModelChatMessage): void {
    render(renderModelMessage(msg, mockRenderer), container);
  }

  describe('Final Answer Rendering', () => {
    it('renders final answer text with correct classes', async () => {
      const msg = createFinalMessage('Here is the answer.');
      renderToContainer(msg);
      await raf();

      const messageEl = container.querySelector('.message.model-message.final');
      assert.isNotNull(messageEl, 'Should render model-message with final class');

      const textEl = container.querySelector('.message-text');
      assert.isNotNull(textEl, 'Should render message-text element');
      assert.include(textEl!.textContent, 'Here is the answer.');
    });

    it('renders empty answer without crashing', async () => {
      const msg = createFinalMessage('');
      renderToContainer(msg);
      await raf();

      const messageEl = container.querySelector('.message.model-message.final');
      assert.isNotNull(messageEl, 'Should render even with empty answer');
    });

    it('handles missing answer gracefully', async () => {
      const msg = createFinalMessage(undefined as unknown as string);
      renderToContainer(msg);
      await raf();

      const messageEl = container.querySelector('.message.model-message.final');
      assert.isNotNull(messageEl, 'Should render without crashing');

      // message-text should not be rendered when answer is falsy
      const textEl = container.querySelector('.message-text');
      assert.isNull(textEl, 'Should not render message-text when answer is undefined');
    });
  });

  describe('Reasoning Block', () => {
    it('shows reasoning block when reasoning is present', async () => {
      const msg = createFinalMessage('Final answer', {
        reasoning: ['Step 1: Analyzed the problem', 'Step 2: Found solution'],
      });
      renderToContainer(msg);
      await raf();

      const reasoningBlock = container.querySelector('.reasoning-block');
      assert.isNotNull(reasoningBlock, 'Should render reasoning block');

      const reasoningDetails = container.querySelector('.reasoning-details');
      assert.isNotNull(reasoningDetails, 'Should render reasoning details element');

      const reasoningSummary = container.querySelector('.reasoning-summary');
      assert.isNotNull(reasoningSummary, 'Should render reasoning summary');
      assert.include(reasoningSummary!.textContent, 'Model Reasoning');
    });

    it('renders all reasoning items', async () => {
      const msg = createFinalMessage('Answer', {
        reasoning: ['First thought', 'Second thought', 'Third thought'],
      });
      renderToContainer(msg);
      await raf();

      const reasoningItems = container.querySelectorAll('.reasoning-item');
      assert.strictEqual(reasoningItems.length, 3, 'Should render all reasoning items');
    });

    it('hides reasoning block when reasoning is absent', async () => {
      const msg = createFinalMessage('Answer without reasoning');
      renderToContainer(msg);
      await raf();

      const reasoningBlock = container.querySelector('.reasoning-block');
      assert.isNull(reasoningBlock, 'Should not render reasoning block');
    });

    it('hides reasoning block when reasoning is empty array', async () => {
      const msg = createFinalMessage('Answer', {
        reasoning: [],
      });
      renderToContainer(msg);
      await raf();

      const reasoningBlock = container.querySelector('.reasoning-block');
      assert.isNull(reasoningBlock, 'Should not render reasoning block for empty array');
    });

    it('hides reasoning block when reasoning is null', async () => {
      const msg = createFinalMessage('Answer', {
        reasoning: null,
      });
      renderToContainer(msg);
      await raf();

      const reasoningBlock = container.querySelector('.reasoning-block');
      assert.isNull(reasoningBlock, 'Should not render reasoning block for null');
    });
  });

  describe('Error State', () => {
    it('displays error when error is present', async () => {
      const msg = createFinalMessage('Partial answer', {
        error: 'Processing error occurred',
      });
      renderToContainer(msg);
      await raf();

      const errorEl = container.querySelector('.message-error');
      assert.isNotNull(errorEl, 'Should render error element');
      assert.include(errorEl!.textContent, 'Processing error occurred');
    });

    it('does not show error element when no error', async () => {
      const msg = createFinalMessage('Normal answer');
      renderToContainer(msg);
      await raf();

      const errorEl = container.querySelector('.message-error');
      assert.isNull(errorEl, 'Should not render error element');
    });

    it('shows both answer and error together', async () => {
      const msg = createFinalMessage('Partial result', {
        error: 'Truncated due to limit',
      });
      renderToContainer(msg);
      await raf();

      const textEl = container.querySelector('.message-text');
      const errorEl = container.querySelector('.message-error');

      assert.isNotNull(textEl, 'Should render answer text');
      assert.isNotNull(errorEl, 'Should render error');
    });
  });

  describe('Tool Call Messages', () => {
    it('returns empty template for tool action messages', async () => {
      const msg = createToolMessage('fetch', {
        toolArgs: { url: 'https://example.com' },
      });
      renderToContainer(msg);
      await raf();

      // Tool messages should render empty (handled elsewhere)
      const messageEl = container.querySelector('.message');
      assert.isNull(messageEl, 'Should not render message element for tool calls');
    });
  });

  describe('Large Content Handling', () => {
    it('renders very long answer without freezing', async () => {
      const longAnswer = 'Response '.repeat(5000);
      const msg = createFinalMessage(longAnswer);

      const startTime = Date.now();
      renderToContainer(msg);
      await raf();
      const duration = Date.now() - startTime;

      const textEl = container.querySelector('.message-text');
      assert.isNotNull(textEl);
      assert.isBelow(duration, 2000, 'Should render large content quickly');
    });

    it('renders many reasoning items without freezing', async () => {
      const manyReasons = Array.from({ length: 100 }, (_, i) => `Reasoning step ${i + 1}`);
      const msg = createFinalMessage('Answer', { reasoning: manyReasons });

      const startTime = Date.now();
      renderToContainer(msg);
      await raf();
      const duration = Date.now() - startTime;

      const reasoningItems = container.querySelectorAll('.reasoning-item');
      assert.strictEqual(reasoningItems.length, 100);
      assert.isBelow(duration, 2000, 'Should render many items quickly');
    });
  });
});
