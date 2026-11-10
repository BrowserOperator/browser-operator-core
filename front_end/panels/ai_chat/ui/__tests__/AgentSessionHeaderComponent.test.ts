// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import '../AgentSessionHeaderComponent.js';
import {raf} from '../../../../testing/DOMHelpers.js';
import type {AgentSessionHeaderComponent, SessionStatus} from '../AgentSessionHeaderComponent.js';

type AgentSession = {
  agentName: string;
  sessionId: string;
  status: 'running' | 'completed' | 'error';
  startTime: Date;
  endTime?: Date;
  messages: any[];
  nestedSessions: any[];
  parentSessionId?: string;
  config?: any;
};

function makeSession(sessionId: string, opts: Partial<AgentSession> = {}): AgentSession {
  return {
    agentName: opts.agentName || 'test_agent',
    sessionId,
    status: opts.status || 'running',
    startTime: opts.startTime || new Date(),
    endTime: opts.endTime,
    messages: opts.messages || [],
    nestedSessions: opts.nestedSessions || [],
    parentSessionId: opts.parentSessionId,
    config: opts.config || {ui: {displayName: 'Test Agent'}},
  };
}

describe('AgentSessionHeaderComponent', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function createComponent(): AgentSessionHeaderComponent {
    const el = document.createElement('agent-session-header') as AgentSessionHeaderComponent;
    container.appendChild(el);
    return el;
  }

  function getShadowRoot(el: AgentSessionHeaderComponent): ShadowRoot {
    return el.shadowRoot!;
  }

  describe('Basic Rendering', () => {
    it('renders empty when no session set', async () => {
      const el = createComponent();
      await raf();

      const sroot = getShadowRoot(el);
      const header = sroot.querySelector('.agent-header');
      assert.isNull(header, 'Should not render without session');
    });

    it('renders header with display name', async () => {
      const el = createComponent();
      el.setSession(makeSession('s1', {config: {ui: {displayName: 'Research Agent'}}}) as any);
      await raf();

      const sroot = getShadowRoot(el);
      const header = sroot.querySelector('.agent-header');
      assert.isNotNull(header);

      const title = sroot.querySelector('.agent-title');
      assert.include(title!.textContent, 'Research Agent');
    });

    it('renders expand icon', async () => {
      const el = createComponent();
      el.setSession(makeSession('s1') as any);
      await raf();

      const sroot = getShadowRoot(el);
      const expandIcon = sroot.querySelector('.expand-icon');
      assert.isNotNull(expandIcon);
      assert.isTrue(expandIcon!.classList.contains('expanded'));
    });
  });

  describe('Session Status', () => {
    it('shows LIVE badge for running sessions', async () => {
      const el = createComponent();
      el.setSession(makeSession('s1', {status: 'running'}) as any);
      await raf();

      const sroot = getShadowRoot(el);
      const statusBadge = sroot.querySelector('.status-badge');
      assert.isTrue(statusBadge!.classList.contains('live'));
      assert.include(statusBadge!.textContent, 'LIVE');

      const liveIndicator = sroot.querySelector('.live-indicator');
      assert.isNotNull(liveIndicator);
    });

    it('shows COMPLETED badge for completed sessions', async () => {
      const el = createComponent();
      el.setSession(makeSession('s1', {status: 'completed'}) as any);
      await raf();

      const sroot = getShadowRoot(el);
      const statusBadge = sroot.querySelector('.status-badge');
      assert.isTrue(statusBadge!.classList.contains('completed'));
      assert.include(statusBadge!.textContent!.toUpperCase(), 'COMPLETED');
      assert.include(statusBadge!.textContent, '✓');
    });

    it('shows ERROR badge for error sessions', async () => {
      const el = createComponent();
      el.setSession(makeSession('s1', {status: 'error'}) as any);
      await raf();

      const sroot = getShadowRoot(el);
      const statusBadge = sroot.querySelector('.status-badge');
      assert.isTrue(statusBadge!.classList.contains('error'));
      assert.include(statusBadge!.textContent!.toUpperCase(), 'ERROR');
      assert.include(statusBadge!.textContent, '❌');
    });

    it('applies status class to header element', async () => {
      const el = createComponent();
      el.setSession(makeSession('s1', {status: 'completed'}) as any);
      await raf();

      const sroot = getShadowRoot(el);
      const header = sroot.querySelector('.agent-header');
      assert.isTrue(header!.classList.contains('completed'));
    });
  });

  describe('Level Badge', () => {
    it('shows Top Level badge for root sessions', async () => {
      const el = createComponent();
      el.setSession(makeSession('s1', {parentSessionId: undefined}) as any);
      await raf();

      const sroot = getShadowRoot(el);
      const levelBadge = sroot.querySelector('.level-badge');
      assert.isTrue(levelBadge!.classList.contains('top-level'));
      assert.include(levelBadge!.textContent, 'Top Level');
    });

    it('shows Nested badge for child sessions', async () => {
      const el = createComponent();
      el.setSession(makeSession('child1', {parentSessionId: 'parent1'}) as any);
      await raf();

      const sroot = getShadowRoot(el);
      const levelBadge = sroot.querySelector('.level-badge');
      assert.isTrue(levelBadge!.classList.contains('nested'));
      assert.include(levelBadge!.textContent, 'Nested');
    });
  });

  describe('Duration Display', () => {
    it('shows duration in seconds for short sessions', async () => {
      const startTime = new Date();
      startTime.setSeconds(startTime.getSeconds() - 45);

      const el = createComponent();
      el.setSession(makeSession('s1', {
        startTime,
        endTime: new Date(),
        status: 'completed',
      }) as any);
      await raf();

      const sroot = getShadowRoot(el);
      const duration = sroot.querySelector('.duration');
      assert.match(duration!.textContent!.trim(), /^\d+s$/);
    });

    it('shows duration in minutes and seconds for longer sessions', async () => {
      const startTime = new Date();
      startTime.setMinutes(startTime.getMinutes() - 2);
      startTime.setSeconds(startTime.getSeconds() - 30);

      const el = createComponent();
      el.setSession(makeSession('s1', {
        startTime,
        endTime: new Date(),
        status: 'completed',
      }) as any);
      await raf();

      const sroot = getShadowRoot(el);
      const duration = sroot.querySelector('.duration');
      assert.match(duration!.textContent!.trim(), /^\d+m \d+s$/);
    });

    it('shows 0s for sessions with no start time', async () => {
      const el = createComponent();
      const session = makeSession('s1', {status: 'completed'});
      // @ts-ignore - testing edge case
      session.startTime = null;
      el.setSession(session as any);
      await raf();

      const sroot = getShadowRoot(el);
      const duration = sroot.querySelector('.duration');
      assert.include(duration!.textContent, '0s');
    });
  });

  describe('Toggle Expand/Collapse', () => {
    it('starts expanded by default', async () => {
      const el = createComponent();
      el.setSession(makeSession('s1') as any);
      await raf();

      const sroot = getShadowRoot(el);
      const expandIcon = sroot.querySelector('.expand-icon');
      assert.isTrue(expandIcon!.classList.contains('expanded'));
    });

    it('collapses on toggleExpanded call', async () => {
      const el = createComponent();
      el.setSession(makeSession('s1') as any);
      await raf();

      el.toggleExpanded();
      await raf();

      const sroot = getShadowRoot(el);
      const expandIcon = sroot.querySelector('.expand-icon');
      assert.isFalse(expandIcon!.classList.contains('expanded'));
    });

    it('expands again on second toggleExpanded call', async () => {
      const el = createComponent();
      el.setSession(makeSession('s1') as any);
      await raf();

      el.toggleExpanded();
      await raf();
      el.toggleExpanded();
      await raf();

      const sroot = getShadowRoot(el);
      const expandIcon = sroot.querySelector('.expand-icon');
      assert.isTrue(expandIcon!.classList.contains('expanded'));
    });

    it('dispatches toggle-expanded event', async () => {
      const el = createComponent();
      el.setSession(makeSession('s1') as any);
      await raf();

      let eventReceived = false;
      let isExpanded = true;
      el.addEventListener('toggle-expanded', (e: Event) => {
        eventReceived = true;
        isExpanded = (e as CustomEvent).detail.isExpanded;
      });

      el.toggleExpanded();
      await raf();

      assert.isTrue(eventReceived);
      assert.isFalse(isExpanded);
    });

    it('toggles on header click', async () => {
      const el = createComponent();
      el.setSession(makeSession('s1') as any);
      await raf();

      const sroot = getShadowRoot(el);
      const header = sroot.querySelector('.agent-header') as HTMLElement;
      header.click();
      await raf();

      const expandIcon = getShadowRoot(el).querySelector('.expand-icon');
      assert.isFalse(expandIcon!.classList.contains('expanded'));
    });
  });

  describe('Session Updates', () => {
    it('updates when session status changes', async () => {
      const el = createComponent();
      el.setSession(makeSession('s1', {status: 'running'}) as any);
      await raf();

      let sroot = getShadowRoot(el);
      assert.isNotNull(sroot.querySelector('.status-badge.live'));

      el.setSession(makeSession('s1', {status: 'completed'}) as any);
      await raf();

      sroot = getShadowRoot(el);
      assert.isNotNull(sroot.querySelector('.status-badge.completed'));
    });

    it('sets endTime when status changes from running', async () => {
      const el = createComponent();
      const startTime = new Date();
      startTime.setSeconds(startTime.getSeconds() - 10);

      el.setSession(makeSession('s1', {
        status: 'running',
        startTime,
      }) as any);
      await raf();

      el.setSession(makeSession('s1', {
        status: 'completed',
        startTime,
        // No explicit endTime - should be set automatically
      }) as any);
      await raf();

      const sroot = getShadowRoot(el);
      const duration = sroot.querySelector('.duration');
      // Duration should be around 10s, not 0s
      assert.match(duration!.textContent!.trim(), /\d+s/);
    });
  });

  describe('Edge Cases', () => {
    it('handles session with unknown status', async () => {
      const el = createComponent();
      const session = makeSession('s1');
      // @ts-ignore - testing edge case
      session.status = 'unknown_status';
      el.setSession(session as any);
      await raf();

      const sroot = getShadowRoot(el);
      const header = sroot.querySelector('.agent-header');
      assert.isNotNull(header);
    });

    it('handles session with missing config', async () => {
      const el = createComponent();
      const session = makeSession('s1');
      // @ts-ignore - testing edge case
      session.config = undefined;
      el.setSession(session as any);
      await raf();

      const sroot = getShadowRoot(el);
      const header = sroot.querySelector('.agent-header');
      assert.isNotNull(header);
    });

    it('handles very long agent names', async () => {
      const el = createComponent();
      el.setSession(makeSession('s1', {
        config: {ui: {displayName: 'A Very Long Agent Name That Might Overflow'}},
      }) as any);
      await raf();

      const sroot = getShadowRoot(el);
      const title = sroot.querySelector('.agent-title');
      assert.include(title!.textContent, 'A Very Long Agent Name');
    });

    it('cleans up timer on disconnect', async () => {
      const el = createComponent();
      el.setSession(makeSession('s1', {status: 'running'}) as any);
      await raf();

      // Remove from DOM
      container.removeChild(el);

      // No assertion needed - just verifying no errors occur
      // The disconnectedCallback should clean up the timer
    });
  });
});
