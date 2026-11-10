// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Shadow Piercer Runtime Script
 *
 * This is the injectable script that runs in the page context to:
 * 1. Patch Element.attachShadow to capture closed shadow roots
 * 2. Expose __browserOperator__.resolveSimpleXPath for composed tree XPath
 *
 * This file has NO dependencies so it can be imported by both:
 * - DevTools (ShadowPiercer.ts)
 * - Eval runner (BrowserExecutor.ts)
 */

export const SHADOW_PIERCER_RUNTIME = `
(function() {
  // Idempotent - don't reinstall if already present
  if (window.__browserOperatorInjected) return;

  const state = {
    hostToRoot: new WeakMap(),
    openCount: 0,
    closedCount: 0,
    debug: false
  };

  /**
   * Get children through the composed tree (including shadow DOM)
   */
  const composedChildren = (node) => {
    const out = [];
    if (node instanceof Document) {
      if (node.documentElement) out.push(node.documentElement);
      return out;
    }
    if (node instanceof ShadowRoot || node instanceof DocumentFragment) {
      out.push(...Array.from(node.children));
      return out;
    }
    if (node instanceof Element) {
      // Light DOM children
      out.push(...Array.from(node.children));
      // Open shadow root children
      const open = node.shadowRoot;
      if (open) out.push(...Array.from(open.children));
      // Closed shadow root children (captured by our patch)
      const closed = state.hostToRoot.get(node);
      if (closed && closed !== open) out.push(...Array.from(closed.children));
    }
    return out;
  };

  /**
   * Get all descendants through the composed tree
   */
  const composedDescendants = (node) => {
    const out = [];
    const queue = [...composedChildren(node)];
    while (queue.length) {
      const el = queue.shift();
      out.push(el);
      queue.push(...composedChildren(el));
    }
    return out;
  };

  /**
   * Simple composed-tree XPath resolver
   * Supports: '/', '//' axis and trailing [n] predicates
   * Does NOT support: complex predicates, attributes, or cross-frame hops
   */
  const resolveSimpleXPath = (xp) => {
    const path = String(xp || '').trim().replace(/^xpath=/i, '');
    if (!path) return null;

    // Parse XPath into steps
    const steps = [];
    let i = 0;
    while (i < path.length) {
      let axis = 'child';
      if (path.startsWith('//', i)) {
        axis = 'desc';
        i += 2;
      } else if (path[i] === '/') {
        axis = 'child';
        i += 1;
      }

      const start = i;
      while (i < path.length && path[i] !== '/') i++;
      const raw = path.slice(start, i).trim();
      if (!raw) continue;

      // Parse step: tagname[index]
      const m = raw.match(/^(.*?)(\\[(\\d+)\\])?$/u);
      const base = (m?.[1] ?? raw).trim();
      const index = m?.[3] ? Math.max(1, Number(m[3])) : null;
      const tag = base === '' ? '*' : base.toLowerCase();
      steps.push({ axis, raw, tag, index });
    }

    // Resolve through composed tree
    let current = [document];
    for (const step of steps) {
      let chosen = null;
      for (const root of current) {
        const pool = step.axis === 'child'
          ? composedChildren(root)
          : composedDescendants(root);
        const matches = pool.filter(el =>
          step.tag === '*' || el.localName === step.tag
        );
        if (!matches.length) continue;

        chosen = step.index != null
          ? matches[step.index - 1] ?? null
          : matches[0];
        if (chosen) break;
      }
      if (!chosen) return null;
      current = [chosen];
    }

    return current[0] ?? null;
  };

  // Patch Element.prototype.attachShadow to capture all shadow roots
  const original = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    const mode = init?.mode ?? 'open';
    const root = original.call(this, init);
    try {
      state.hostToRoot.set(this, root);
      if (mode === 'closed') {
        state.closedCount++;
      } else {
        state.openCount++;
      }
      if (state.debug) {
        console.info('[browser-operator-piercer] attachShadow', {
          tag: this.tagName?.toLowerCase() ?? '',
          mode,
          url: location.href
        });
      }
    } catch {}
    return root;
  };

  // Expose backdoor API
  window.__browserOperator__ = {
    getClosedRoot: (host) => state.hostToRoot.get(host),
    stats: () => ({
      installed: true,
      url: location.href,
      isTop: window.top === window,
      open: state.openCount,
      closed: state.closedCount
    }),
    resolveSimpleXPath
  };

  window.__browserOperatorInjected = true;

  if (state.debug) {
    console.info('[browser-operator-piercer] installed', {
      url: location.href,
      isTop: window.top === window,
      readyState: document.readyState
    });
  }
})();
`;
