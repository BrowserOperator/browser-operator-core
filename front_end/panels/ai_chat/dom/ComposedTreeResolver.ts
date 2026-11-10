// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Composed Tree Resolver
 *
 * Utilities for resolving XPath and CSS selectors through the composed DOM tree
 * (including shadow DOM). Also provides support for the '>>' hop notation for
 * traversing iframe boundaries.
 *
 */

import * as SDK from '../../../core/sdk/sdk.js';
import type * as Protocol from '../../../generated/protocol.js';

/**
 * Result of parsing a selector with hop notation
 */
export interface HopResult {
  /** Selectors for each iframe to traverse before reaching target */
  frameHops: string[];
  /** Final selector within the target frame */
  finalSelector: string;
}

/**
 * Parse a selector with '>>' hop notation for iframe traversal.
 * Example: 'iframe#ifrA >> #container >> button' splits into frameHops and finalSelector.
 */
export function parseHopNotation(selector: string): HopResult {
  const parts = selector.split('>>').map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return {frameHops: [], finalSelector: selector.trim()};
  }
  return {
    frameHops: parts.slice(0, -1),
    finalSelector: parts[parts.length - 1],
  };
}

/**
 * XPath step axis types
 */
type Axis = 'child'|'desc';

/**
 * Parsed XPath step
 */
interface XPathStep {
  /** 'child' for '/', 'desc' for '//' */
  axis: Axis;
  /** Raw step text including predicates */
  raw: string;
  /** Tag name (lowercase, without predicates) */
  name: string;
}

/**
 * Parse an XPath into individual steps.
 * Handles '/' (child) and '//' (descendant) axes.
 */
export function parseXPathToSteps(path: string): XPathStep[] {
  const s = path.trim().replace(/^xpath=/i, '');
  let i = 0;
  const steps: XPathStep[] = [];

  while (i < s.length) {
    let axis: Axis = 'child';
    if (s.startsWith('//', i)) {
      axis = 'desc';
      i += 2;
    } else if (s[i] === '/') {
      axis = 'child';
      i += 1;
    }

    const start = i;
    while (i < s.length && s[i] !== '/') {
      i++;
    }
    const raw = s.slice(start, i).trim();
    if (!raw) {
      continue;
    }

    // Extract tag name without predicates
    const name = raw.replace(/\[\d+\]\s*$/u, '').toLowerCase();
    steps.push({axis, raw, name});
  }
  return steps;
}

/**
 * Build an XPath string from parsed steps.
 */
export function buildXPathFromSteps(steps: ReadonlyArray<XPathStep>): string {
  let out = '';
  for (const st of steps) {
    out += st.axis === 'desc' ? '//' : '/';
    out += st.raw;
  }
  return out || '/';
}

/**
 * Check if an XPath step represents an iframe element.
 */
const IFRAME_STEP_RE = /^iframe(?:\[\d+])?$/i;

export function isIframeStep(step: XPathStep): boolean {
  return IFRAME_STEP_RE.test(step.name);
}

/**
 * Result of resolving an element
 */
export interface ResolvedElement {
  /** Runtime object ID for the element */
  objectId?: string;
  /** Backend DOM node ID */
  backendNodeId?: number;
}

/**
 * Resolve an element using the composed tree XPath resolver.
 * This uses the injected __browserOperator__.resolveSimpleXPath if available,
 * falling back to standard document.evaluate.
 */
export async function resolveComposedXPath(
    target: SDK.Target.Target,
    xpath: string,
    executionContextId?: number,
): Promise<ResolvedElement|null> {
  const expression = `
    (() => {
      const xp = ${JSON.stringify(xpath)};
      try {
        // Try composed tree resolver first (handles shadow DOM)
        if (window.__browserOperator__?.resolveSimpleXPath) {
          return window.__browserOperator__.resolveSimpleXPath(xp);
        }
      } catch {}
      try {
        // Fall back to standard XPath evaluation
        const res = document.evaluate(
          xp.replace(/^xpath=/i, ''),
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        return res.singleNodeValue;
      } catch { return null; }
    })()
  `;

  try {
    const runtimeAgent = target.runtimeAgent();
    const params: Protocol.Runtime.EvaluateRequest = {
      expression,
      returnByValue: false,
    };
    if (executionContextId !== undefined) {
      params.contextId = executionContextId as Protocol.Runtime.ExecutionContextId;
    }
    const result = await runtimeAgent.invoke_evaluate(params);

    if (!result?.result?.objectId) {
      return null;
    }

    // Get backend node ID
    const domModel = target.model(SDK.DOMModel.DOMModel);
    if (domModel) {
      try {
        const node = await domModel.pushNodeToFrontend(result.result.objectId);
        if (node) {
          return {
            objectId: result.result.objectId,
            backendNodeId: node.backendNodeId(),
          };
        }
      } catch {
        // Node may have been removed
      }
    }

    return {objectId: result.result.objectId};
  } catch {
    return null;
  }
}

/**
 * Resolve a CSS selector through shadow DOM using the piercer backdoor.
 * Searches through both open and closed shadow roots.
 */
export async function resolveComposedCss(
    target: SDK.Target.Target,
    selector: string,
    executionContextId?: number,
): Promise<ResolvedElement|null> {
  const expression = `
    (() => {
      const selector = ${JSON.stringify(selector)};

      // Helper: search through open shadow roots
      function queryOpenDeep(root) {
        try {
          const hit = root.querySelector(selector);
          if (hit) return hit;
        } catch {}

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let n;
        while ((n = walker.nextNode())) {
          if (n.shadowRoot) {
            const found = queryOpenDeep(n.shadowRoot);
            if (found) return found;
          }
        }
        return null;
      }

      // If backdoor available, search closed roots too
      const backdoor = window.__browserOperator__;
      if (backdoor && typeof backdoor.getClosedRoot === 'function') {
        function* allRoots() {
          yield document;
          const queue = [];
          try {
            const w = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
            let e;
            while ((e = w.nextNode())) {
              if (e.shadowRoot) queue.push(e.shadowRoot);
              try {
                const closed = backdoor.getClosedRoot(e);
                if (closed) queue.push(closed);
              } catch {}
            }
          } catch {}

          while (queue.length) {
            const r = queue.shift();
            yield r;
            try {
              const w2 = document.createTreeWalker(r, NodeFilter.SHOW_ELEMENT);
              let e2;
              while ((e2 = w2.nextNode())) {
                if (e2.shadowRoot) queue.push(e2.shadowRoot);
                try {
                  const closed2 = backdoor.getClosedRoot(e2);
                  if (closed2) queue.push(closed2);
                } catch {}
              }
            } catch {}
          }
        }

        for (const r of allRoots()) {
          try {
            const hit = r.querySelector(selector);
            if (hit) return hit;
          } catch {}
        }
        return null;
      }

      // No backdoor - just search open roots
      return queryOpenDeep(document);
    })()
  `;

  try {
    const runtimeAgent = target.runtimeAgent();
    const params: Protocol.Runtime.EvaluateRequest = {
      expression,
      returnByValue: false,
    };
    if (executionContextId !== undefined) {
      params.contextId = executionContextId as Protocol.Runtime.ExecutionContextId;
    }
    const result = await runtimeAgent.invoke_evaluate(params);

    if (!result?.result?.objectId) {
      return null;
    }

    // Get backend node ID
    const domModel = target.model(SDK.DOMModel.DOMModel);
    if (domModel) {
      try {
        const node = await domModel.pushNodeToFrontend(result.result.objectId);
        if (node) {
          return {
            objectId: result.result.objectId,
            backendNodeId: node.backendNodeId(),
          };
        }
      } catch {
        // Node may have been removed
      }
    }

    return {objectId: result.result.objectId};
  } catch {
    return null;
  }
}

/**
 * Resolve a selector (XPath or CSS) with optional hop notation.
 * Supports both 'xpath=' prefixed paths and plain CSS selectors.
 */
export async function resolveSelector(
    target: SDK.Target.Target,
    selector: string,
    executionContextId?: number,
): Promise<ResolvedElement|null> {
  const trimmed = selector.trim();
  const isXPath = trimmed.startsWith('xpath=') || trimmed.startsWith('/');

  if (isXPath) {
    return resolveComposedXPath(target, trimmed, executionContextId);
  }
  return resolveComposedCss(target, trimmed, executionContextId);
}
