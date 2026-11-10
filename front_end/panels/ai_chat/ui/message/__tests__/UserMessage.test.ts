// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Lit from '../../../../../ui/lit/lit.js';
import {renderUserMessage} from '../UserMessage.js';
import {raf} from '../../../../../testing/DOMHelpers.js';
import {ChatMessageEntity} from '../../../models/ChatTypes.js';
import type {UserChatMessage} from '../../../models/ChatTypes.js';

const {render} = Lit;

describe('UserMessage Renderer', () => {
  let container: HTMLDivElement;
  let mockRenderer: any;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    // Simple mock markdown renderer that returns plain text
    mockRenderer = {
      renderMarkdown: (text: string) => text,
    };
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function createUserMessage(text: string, options?: Partial<UserChatMessage>): UserChatMessage {
    return {
      entity: ChatMessageEntity.USER,
      text,
      ...options,
    };
  }

  function renderToContainer(msg: UserChatMessage): void {
    render(renderUserMessage(msg, mockRenderer), container);
  }

  it('renders plain text messages', async () => {
    const msg = createUserMessage('Hello, world!');
    renderToContainer(msg);
    await raf();

    const messageEl = container.querySelector('.message.user-message');
    assert.isNotNull(messageEl, 'Should render user-message element');

    const textEl = container.querySelector('.message-text');
    assert.isNotNull(textEl, 'Should render message-text element');
    assert.include(textEl!.textContent, 'Hello, world!');
  });

  it('renders empty string without crashing', async () => {
    const msg = createUserMessage('');
    renderToContainer(msg);
    await raf();

    const messageEl = container.querySelector('.message.user-message');
    assert.isNotNull(messageEl, 'Should render even with empty text');
  });

  it('renders message with special characters', async () => {
    const msg = createUserMessage('<script>alert("xss")</script>');
    renderToContainer(msg);
    await raf();

    const textEl = container.querySelector('.message-text');
    assert.isNotNull(textEl);
    // Content should be escaped or rendered safely
    assert.include(textEl!.textContent, '<script>');
  });

  it('displays error state when error is present', async () => {
    const msg = createUserMessage('Failed message', {
      error: 'Network error occurred',
    });
    renderToContainer(msg);
    await raf();

    const errorEl = container.querySelector('.message-error');
    assert.isNotNull(errorEl, 'Should render error element');
    assert.include(errorEl!.textContent, 'Network error occurred');
  });

  it('does not show error element when no error', async () => {
    const msg = createUserMessage('Normal message');
    renderToContainer(msg);
    await raf();

    const errorEl = container.querySelector('.message-error');
    assert.isNull(errorEl, 'Should not render error element');
  });

  it('renders message with multiline text', async () => {
    const msg = createUserMessage('Line 1\nLine 2\nLine 3');
    renderToContainer(msg);
    await raf();

    const textEl = container.querySelector('.message-text');
    assert.isNotNull(textEl);
    assert.include(textEl!.textContent, 'Line 1');
    assert.include(textEl!.textContent, 'Line 2');
    assert.include(textEl!.textContent, 'Line 3');
  });

  it('renders message with very long text without freezing', async () => {
    const longText = 'A'.repeat(10000);
    const msg = createUserMessage(longText);

    const startTime = Date.now();
    renderToContainer(msg);
    await raf();
    const duration = Date.now() - startTime;

    const textEl = container.querySelector('.message-text');
    assert.isNotNull(textEl);
    // Should complete in reasonable time (less than 1 second)
    assert.isBelow(duration, 1000, 'Rendering should complete quickly');
  });

  it('handles null/undefined text gracefully', async () => {
    // Force null text to test defensive coding
    const msg = createUserMessage(null as unknown as string);
    renderToContainer(msg);
    await raf();

    const messageEl = container.querySelector('.message.user-message');
    assert.isNotNull(messageEl, 'Should render without crashing');
  });
});
