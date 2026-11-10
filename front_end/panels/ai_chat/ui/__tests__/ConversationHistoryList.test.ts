// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import '../ConversationHistoryList.js';
import {raf} from '../../../../testing/DOMHelpers.js';
import type {ConversationHistoryList} from '../ConversationHistoryList.js';

type ConversationMetadata = {
  id: string;
  title: string;
  preview?: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
};

function makeConversation(id: string, opts: Partial<ConversationMetadata> = {}): ConversationMetadata {
  return {
    id,
    title: opts.title || `Conversation ${id}`,
    preview: opts.preview,
    messageCount: opts.messageCount ?? 5,
    createdAt: opts.createdAt ?? Date.now() - 3600000,
    updatedAt: opts.updatedAt ?? Date.now(),
  };
}

describe('ConversationHistoryList Component', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function createComponent(): ConversationHistoryList {
    const el = document.createElement('ai-conversation-history-list') as ConversationHistoryList;
    container.appendChild(el);
    return el;
  }

  function getShadowRoot(el: ConversationHistoryList): ShadowRoot {
    return el.shadowRoot!;
  }

  describe('Basic Rendering', () => {
    it('renders header with title', async () => {
      const el = createComponent();
      await raf();

      const sroot = getShadowRoot(el);
      const title = sroot.querySelector('.history-title');
      assert.isNotNull(title);
      assert.include(title!.textContent, 'Chat History');
    });

    it('renders close button', async () => {
      const el = createComponent();
      await raf();

      const sroot = getShadowRoot(el);
      const closeButton = sroot.querySelector('.history-close-button');
      assert.isNotNull(closeButton);
    });

    it('shows empty state when no conversations', async () => {
      const el = createComponent();
      el.conversations = [];
      await raf();

      const sroot = getShadowRoot(el);
      const emptyState = sroot.querySelector('.history-empty-state');
      assert.isNotNull(emptyState);
      assert.include(emptyState!.textContent, 'No saved conversations yet');
    });
  });

  describe('Conversation Display', () => {
    it('renders conversation items', async () => {
      const el = createComponent();
      el.conversations = [
        makeConversation('c1', {title: 'First Chat'}),
        makeConversation('c2', {title: 'Second Chat'}),
      ];
      await raf();

      const sroot = getShadowRoot(el);
      const items = sroot.querySelectorAll('.history-conversation-item');
      assert.strictEqual(items.length, 2);
    });

    it('displays conversation title', async () => {
      const el = createComponent();
      el.conversations = [makeConversation('c1', {title: 'Test Conversation'})];
      await raf();

      const sroot = getShadowRoot(el);
      const title = sroot.querySelector('.history-conversation-title');
      assert.include(title!.textContent, 'Test Conversation');
    });

    it('displays conversation preview when available', async () => {
      const el = createComponent();
      el.conversations = [
        makeConversation('c1', {preview: 'This is a preview of the conversation...'}),
      ];
      await raf();

      const sroot = getShadowRoot(el);
      const preview = sroot.querySelector('.history-conversation-preview');
      assert.isNotNull(preview);
      assert.include(preview!.textContent, 'This is a preview');
    });

    it('hides preview when not available', async () => {
      const el = createComponent();
      el.conversations = [makeConversation('c1', {preview: undefined})];
      await raf();

      const sroot = getShadowRoot(el);
      const preview = sroot.querySelector('.history-conversation-preview');
      assert.isNull(preview);
    });

    it('displays message count', async () => {
      const el = createComponent();
      el.conversations = [makeConversation('c1', {messageCount: 42})];
      await raf();

      const sroot = getShadowRoot(el);
      const metadata = sroot.querySelector('.history-conversation-metadata');
      assert.include(metadata!.textContent, '42 messages');
    });

    it('displays delete button for each conversation', async () => {
      const el = createComponent();
      el.conversations = [
        makeConversation('c1'),
        makeConversation('c2'),
      ];
      await raf();

      const sroot = getShadowRoot(el);
      const deleteButtons = sroot.querySelectorAll('.history-delete-button');
      assert.strictEqual(deleteButtons.length, 2);
    });
  });

  describe('Current Conversation Highlighting', () => {
    it('marks current conversation as active', async () => {
      const el = createComponent();
      el.conversations = [
        makeConversation('c1'),
        makeConversation('c2'),
        makeConversation('c3'),
      ];
      el.currentConversationId = 'c2';
      await raf();

      const sroot = getShadowRoot(el);
      const items = sroot.querySelectorAll('.history-conversation-item');
      const activeItems = sroot.querySelectorAll('.history-conversation-item.active');

      assert.strictEqual(items.length, 3);
      assert.strictEqual(activeItems.length, 1);
    });

    it('updates active state when currentConversationId changes', async () => {
      const el = createComponent();
      el.conversations = [
        makeConversation('c1'),
        makeConversation('c2'),
      ];
      el.currentConversationId = 'c1';
      await raf();

      let sroot = getShadowRoot(el);
      let firstItem = sroot.querySelectorAll('.history-conversation-item')[0];
      assert.isTrue(firstItem.classList.contains('active'));

      el.currentConversationId = 'c2';
      await raf();

      sroot = getShadowRoot(el);
      const items = sroot.querySelectorAll('.history-conversation-item');
      assert.isFalse(items[0].classList.contains('active'));
      assert.isTrue(items[1].classList.contains('active'));
    });
  });

  describe('Event Callbacks', () => {
    it('calls onClose when close button clicked', async () => {
      const el = createComponent();
      el.conversations = [];

      let closeCalled = false;
      el.onClose = () => {
        closeCalled = true;
      };
      await raf();

      const sroot = getShadowRoot(el);
      const closeButton = sroot.querySelector('.history-close-button') as HTMLButtonElement;
      closeButton.click();

      assert.isTrue(closeCalled);
    });

    it('calls onConversationSelected when conversation clicked', async () => {
      const el = createComponent();
      el.conversations = [makeConversation('c1')];
      el.currentConversationId = null;

      let selectedId = '';
      el.onConversationSelected = (id) => {
        selectedId = id;
      };
      await raf();

      const sroot = getShadowRoot(el);
      const item = sroot.querySelector('.history-conversation-item') as HTMLElement;
      item.click();

      assert.strictEqual(selectedId, 'c1');
    });

    it('does not call onConversationSelected when clicking current conversation', async () => {
      const el = createComponent();
      el.conversations = [makeConversation('c1')];
      el.currentConversationId = 'c1';

      let callCount = 0;
      el.onConversationSelected = () => {
        callCount++;
      };
      await raf();

      const sroot = getShadowRoot(el);
      const item = sroot.querySelector('.history-conversation-item') as HTMLElement;
      item.click();

      assert.strictEqual(callCount, 0);
    });

    it('calls onDeleteConversation when delete button clicked', async () => {
      const el = createComponent();
      el.conversations = [makeConversation('c1')];

      let deletedId = '';
      el.onDeleteConversation = (id) => {
        deletedId = id;
      };
      await raf();

      const sroot = getShadowRoot(el);
      const deleteButton = sroot.querySelector('.history-delete-button') as HTMLButtonElement;
      deleteButton.click();

      assert.strictEqual(deletedId, 'c1');
    });

    it('stops propagation when delete button clicked', async () => {
      const el = createComponent();
      el.conversations = [makeConversation('c1')];
      el.currentConversationId = null;

      let selectedCalled = false;
      let deletedCalled = false;

      el.onConversationSelected = () => {
        selectedCalled = true;
      };
      el.onDeleteConversation = () => {
        deletedCalled = true;
      };
      await raf();

      const sroot = getShadowRoot(el);
      const deleteButton = sroot.querySelector('.history-delete-button') as HTMLButtonElement;
      deleteButton.click();

      assert.isTrue(deletedCalled);
      assert.isFalse(selectedCalled);
    });

    it('closes after selecting conversation', async () => {
      const el = createComponent();
      el.conversations = [makeConversation('c1')];
      el.currentConversationId = null;

      let closeCalled = false;
      el.onClose = () => {
        closeCalled = true;
      };
      el.onConversationSelected = () => {};
      await raf();

      const sroot = getShadowRoot(el);
      const item = sroot.querySelector('.history-conversation-item') as HTMLElement;
      item.click();

      assert.isTrue(closeCalled);
    });

    it('closes after deleting conversation', async () => {
      const el = createComponent();
      el.conversations = [makeConversation('c1')];

      let closeCalled = false;
      el.onClose = () => {
        closeCalled = true;
      };
      el.onDeleteConversation = () => {};
      await raf();

      const sroot = getShadowRoot(el);
      const deleteButton = sroot.querySelector('.history-delete-button') as HTMLButtonElement;
      deleteButton.click();

      assert.isTrue(closeCalled);
    });
  });

  describe('Date Formatting', () => {
    it('shows "Just now" for very recent conversations', async () => {
      const el = createComponent();
      el.conversations = [makeConversation('c1', {updatedAt: Date.now() - 30000})]; // 30 seconds ago
      await raf();

      const sroot = getShadowRoot(el);
      const metadata = sroot.querySelector('.history-conversation-metadata');
      assert.include(metadata!.textContent, 'Just now');
    });

    it('shows minutes ago for recent conversations', async () => {
      const el = createComponent();
      el.conversations = [makeConversation('c1', {updatedAt: Date.now() - 300000})]; // 5 minutes ago
      await raf();

      const sroot = getShadowRoot(el);
      const metadata = sroot.querySelector('.history-conversation-metadata');
      assert.include(metadata!.textContent, '5m ago');
    });

    it('shows hours ago for today conversations', async () => {
      const el = createComponent();
      el.conversations = [makeConversation('c1', {updatedAt: Date.now() - 7200000})]; // 2 hours ago
      await raf();

      const sroot = getShadowRoot(el);
      const metadata = sroot.querySelector('.history-conversation-metadata');
      assert.include(metadata!.textContent, '2h ago');
    });

    it('shows days ago for recent past conversations', async () => {
      const el = createComponent();
      el.conversations = [makeConversation('c1', {updatedAt: Date.now() - 172800000})]; // 2 days ago
      await raf();

      const sroot = getShadowRoot(el);
      const metadata = sroot.querySelector('.history-conversation-metadata');
      assert.include(metadata!.textContent, '2d ago');
    });
  });

  describe('Property Getters/Setters', () => {
    it('gets and sets conversations', async () => {
      const el = createComponent();
      const conversations = [makeConversation('c1')];

      el.conversations = conversations;
      assert.strictEqual(el.conversations, conversations);
    });

    it('gets and sets currentConversationId', async () => {
      const el = createComponent();

      el.currentConversationId = 'test-id';
      assert.strictEqual(el.currentConversationId, 'test-id');

      el.currentConversationId = null;
      assert.isNull(el.currentConversationId);
    });

    it('gets and sets onConversationSelected', async () => {
      const el = createComponent();
      const callback = () => {};

      el.onConversationSelected = callback;
      assert.strictEqual(el.onConversationSelected, callback);
    });

    it('gets and sets onDeleteConversation', async () => {
      const el = createComponent();
      const callback = () => {};

      el.onDeleteConversation = callback;
      assert.strictEqual(el.onDeleteConversation, callback);
    });

    it('gets and sets onClose', async () => {
      const el = createComponent();
      const callback = () => {};

      el.onClose = callback;
      assert.strictEqual(el.onClose, callback);
    });
  });

  describe('Edge Cases', () => {
    it('handles many conversations', async () => {
      const el = createComponent();
      el.conversations = Array.from({length: 50}, (_, i) =>
        makeConversation(`c${i}`, {title: `Conversation ${i}`}),
      );
      await raf();

      const sroot = getShadowRoot(el);
      const items = sroot.querySelectorAll('.history-conversation-item');
      assert.strictEqual(items.length, 50);
    });

    it('handles long conversation titles', async () => {
      const el = createComponent();
      el.conversations = [
        makeConversation('c1', {
          title: 'This is a very long conversation title that might overflow the container and need to be truncated',
        }),
      ];
      await raf();

      const sroot = getShadowRoot(el);
      const title = sroot.querySelector('.history-conversation-title');
      assert.isNotNull(title);
    });

    it('handles special characters in titles', async () => {
      const el = createComponent();
      el.conversations = [
        makeConversation('c1', {title: '<script>alert("xss")</script>'}),
      ];
      await raf();

      const sroot = getShadowRoot(el);
      const title = sroot.querySelector('.history-conversation-title');
      // Lit should escape HTML automatically
      assert.notInclude(title!.innerHTML, '<script>');
    });

    it('handles null callback gracefully', async () => {
      const el = createComponent();
      el.conversations = [makeConversation('c1')];
      el.onConversationSelected = null;
      el.onClose = null;
      await raf();

      const sroot = getShadowRoot(el);
      const item = sroot.querySelector('.history-conversation-item') as HTMLElement;

      // Should not throw
      item.click();
    });
  });
});
