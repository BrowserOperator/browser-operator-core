// Copyright 2025 The Chromium Authors.

import '../MessageList.js';
import {raf, doubleRaf} from '../../../../../testing/DOMHelpers.js';

describe('MessageList UI', () => {
  function makeMessage(text: string, height = 0): HTMLElement {
    const msg = document.createElement('div');
    msg.textContent = text;
    if (height > 0) {
      msg.setAttribute('style', `display:block; height:${height}px;`);
    }
    return msg;
  }

  describe('Slot Projection', () => {
    it('projects slotted messages into container', async () => {
      const list = document.createElement('ai-message-list');
      // Keep size small; contents will overflow to create scrollbar in later tests
      (list as HTMLElement).style.cssText = 'display:block; height:120px; width:200px;';
      const m1 = makeMessage('Hello');
      const m2 = makeMessage('World');
      list.appendChild(m1);
      list.appendChild(m2);
      document.body.appendChild(list);
      await raf();

      const sroot = list.shadowRoot!;
      const slot = sroot.querySelector('slot') as HTMLSlotElement;
      const assigned = slot.assignedNodes({flatten: true});
      // Both light DOM children are projected via the slot
      assert.strictEqual(assigned.length, 2);
      assert.strictEqual((assigned[0] as HTMLElement).textContent, 'Hello');
      assert.strictEqual((assigned[1] as HTMLElement).textContent, 'World');

      document.body.removeChild(list);
    });

    it('handles empty message list', async () => {
      const list = document.createElement('ai-message-list');
      (list as HTMLElement).style.cssText = 'display:block; height:120px; width:200px;';
      document.body.appendChild(list);
      await raf();

      const sroot = list.shadowRoot!;
      const slot = sroot.querySelector('slot') as HTMLSlotElement;
      const assigned = slot.assignedNodes({flatten: true});
      assert.strictEqual(assigned.length, 0, 'Should handle empty list without errors');

      document.body.removeChild(list);
    });

    it('updates when messages are dynamically added', async () => {
      const list = document.createElement('ai-message-list');
      (list as HTMLElement).style.cssText = 'display:block; height:120px; width:200px;';
      document.body.appendChild(list);
      await raf();

      // Add messages dynamically
      list.appendChild(makeMessage('First'));
      await raf();

      list.appendChild(makeMessage('Second'));
      await raf();

      const sroot = list.shadowRoot!;
      const slot = sroot.querySelector('slot') as HTMLSlotElement;
      const assigned = slot.assignedNodes({flatten: true});
      assert.strictEqual(assigned.length, 2);

      document.body.removeChild(list);
    });

    it('updates when messages are removed', async () => {
      const list = document.createElement('ai-message-list');
      (list as HTMLElement).style.cssText = 'display:block; height:120px; width:200px;';
      const m1 = makeMessage('One');
      const m2 = makeMessage('Two');
      list.appendChild(m1);
      list.appendChild(m2);
      document.body.appendChild(list);
      await raf();

      // Remove first message
      list.removeChild(m1);
      await raf();

      const sroot = list.shadowRoot!;
      const slot = sroot.querySelector('slot') as HTMLSlotElement;
      const assigned = slot.assignedNodes({flatten: true});
      assert.strictEqual(assigned.length, 1);
      assert.strictEqual((assigned[0] as HTMLElement).textContent, 'Two');

      document.body.removeChild(list);
    });
  });

  describe('Auto-Scroll Behavior', () => {
    it('pins to bottom by default and preserves scroll position when user scrolls up', async () => {
      const list = document.createElement('ai-message-list');
      (list as HTMLElement).style.cssText = 'display:block; height:120px; width:200px;';
      // Add enough tall messages to overflow
      for (let i = 0; i < 5; i++) {
        list.appendChild(makeMessage(`Msg ${i}`, 80));
      }
      document.body.appendChild(list);
      await raf();

      const sroot = list.shadowRoot!;
      const container = sroot.querySelector('.container') as HTMLElement;

      // Initially pinned to bottom; after initial render it should end up at bottom
      await raf();
      const atBottomInitial = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
      assert.isTrue(atBottomInitial, 'should pin to bottom initially');

      // Simulate user scroll up -> pin disabled
      container.scrollTop = 0;
      container.dispatchEvent(new Event('scroll'));

      // Append a new tall message; should NOT auto-scroll now
      list.appendChild(makeMessage('New message', 120));
      await raf();
      assert.isBelow(container.scrollTop, container.scrollHeight - container.clientHeight);

      // Scroll to bottom and append again; should auto-pin
      container.scrollTop = container.scrollHeight;
      container.dispatchEvent(new Event('scroll'));
      list.appendChild(makeMessage('Another new message', 120));
      await raf();
      const atBottomFinal = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
      assert.isTrue(atBottomFinal, 'should repin to bottom when user scrolled to end');

      document.body.removeChild(list);
    });

    it('re-pins when scrolled to bottom', async () => {
      const list = document.createElement('ai-message-list');
      (list as HTMLElement).style.cssText = 'display:block; height:120px; width:200px;';
      for (let i = 0; i < 5; i++) {
        list.appendChild(makeMessage(`Msg ${i}`, 80));
      }
      document.body.appendChild(list);
      await raf();

      const sroot = list.shadowRoot!;
      const container = sroot.querySelector('.container') as HTMLElement;

      // Scroll up to disable pinning
      container.scrollTop = 50;
      container.dispatchEvent(new Event('scroll'));

      // Scroll back to bottom
      container.scrollTop = container.scrollHeight;
      container.dispatchEvent(new Event('scroll'));

      // Add new message - should auto-scroll
      list.appendChild(makeMessage('Final', 80));
      await raf();

      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
      assert.isTrue(atBottom, 'Should re-enable pinning when at bottom');

      document.body.removeChild(list);
    });
  });

  describe('Rapid Message Additions', () => {
    it('handles rapid message additions without scroll glitches', async () => {
      const list = document.createElement('ai-message-list');
      (list as HTMLElement).style.cssText = 'display:block; height:120px; width:200px;';
      document.body.appendChild(list);
      await raf();

      const sroot = list.shadowRoot!;
      const container = sroot.querySelector('.container') as HTMLElement;

      // Add many messages rapidly
      for (let i = 0; i < 20; i++) {
        list.appendChild(makeMessage(`Rapid ${i}`, 30));
      }

      // Wait for all renders to settle
      await doubleRaf();

      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
      assert.isTrue(atBottom, 'Should stay pinned to bottom after rapid additions');

      document.body.removeChild(list);
    });

    it('handles burst of messages without losing scroll position when scrolled up', async () => {
      const list = document.createElement('ai-message-list');
      (list as HTMLElement).style.cssText = 'display:block; height:120px; width:200px;';
      for (let i = 0; i < 5; i++) {
        list.appendChild(makeMessage(`Initial ${i}`, 60));
      }
      document.body.appendChild(list);
      await raf();

      const sroot = list.shadowRoot!;
      const container = sroot.querySelector('.container') as HTMLElement;

      // Scroll to middle and disable pinning
      const middleScroll = 100;
      container.scrollTop = middleScroll;
      container.dispatchEvent(new Event('scroll'));

      // Add burst of messages
      for (let i = 0; i < 10; i++) {
        list.appendChild(makeMessage(`Burst ${i}`, 30));
      }
      await doubleRaf();

      // Should preserve scroll position approximately
      assert.isBelow(container.scrollTop, container.scrollHeight - container.clientHeight,
        'Should not auto-scroll when user scrolled up');

      document.body.removeChild(list);
    });
  });

  describe('Edge Cases', () => {
    it('handles very large number of messages', async () => {
      const list = document.createElement('ai-message-list');
      (list as HTMLElement).style.cssText = 'display:block; height:120px; width:200px;';
      document.body.appendChild(list);

      const startTime = Date.now();
      for (let i = 0; i < 100; i++) {
        list.appendChild(makeMessage(`Message ${i}`, 20));
      }
      await raf();
      const duration = Date.now() - startTime;

      const sroot = list.shadowRoot!;
      const slot = sroot.querySelector('slot') as HTMLSlotElement;
      const assigned = slot.assignedNodes({flatten: true});
      assert.strictEqual(assigned.length, 100);
      assert.isBelow(duration, 3000, 'Should handle many messages efficiently');

      document.body.removeChild(list);
    });

    it('handles messages with zero height', async () => {
      const list = document.createElement('ai-message-list');
      (list as HTMLElement).style.cssText = 'display:block; height:120px; width:200px;';
      list.appendChild(makeMessage('Zero height', 0));
      document.body.appendChild(list);
      await raf();

      const sroot = list.shadowRoot!;
      const slot = sroot.querySelector('slot') as HTMLSlotElement;
      const assigned = slot.assignedNodes({flatten: true});
      assert.strictEqual(assigned.length, 1);

      document.body.removeChild(list);
    });

    it('handles container with no overflow', async () => {
      const list = document.createElement('ai-message-list');
      // Large container that won't overflow
      (list as HTMLElement).style.cssText = 'display:block; height:1000px; width:200px;';
      list.appendChild(makeMessage('Small', 20));
      document.body.appendChild(list);
      await raf();

      const sroot = list.shadowRoot!;
      const container = sroot.querySelector('.container') as HTMLElement;

      // No overflow means scrollTop should be 0
      assert.strictEqual(container.scrollTop, 0);

      document.body.removeChild(list);
    });
  });
});

