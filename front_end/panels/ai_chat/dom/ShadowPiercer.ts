// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Shadow Piercer Runtime
 *
 * Enables access to closed shadow roots by patching `Element.attachShadow()`
 * early in the page lifecycle. Provides a composed tree XPath resolver that
 * traverses both open and closed shadow DOM.
 *
 */

import * as SDK from '../../../core/sdk/sdk.js';
import type * as Protocol from '../../../generated/protocol.js';

// Import and re-export the runtime from the shared module (no SDK dependencies)
import {SHADOW_PIERCER_RUNTIME} from './shadow-piercer-runtime.js';
export {SHADOW_PIERCER_RUNTIME};

/**
 * Types for the backdoor API exposed on window.__browserOperator__
 */
export interface BrowserOperatorBackdoor {
  /** Get a closed shadow root for a given host element */
  getClosedRoot(host: Element): ShadowRoot | undefined;
  /** Get stats about installed piercer state */
  stats(): {
    installed: true;
    url: string;
    isTop: boolean;
    open: number;
    closed: number;
  };
  /** Resolve a simple XPath through the composed tree (supports '/', '//', [n]) */
  resolveSimpleXPath(xp: string): Element | null;
}

declare global {
  interface Window {
    __browserOperatorInjected?: boolean;
    __browserOperator__?: BrowserOperatorBackdoor;
  }
}

/**
 * Inject the shadow piercer runtime script into a target.
 * The script will be evaluated on every new document before page scripts run.
 */
export async function injectShadowPiercer(
    target: SDK.Target.Target,
): Promise<void> {
  const pageAgent = target.pageAgent();
  if (!pageAgent) {
    console.warn('[ShadowPiercer] No page agent available for target');
    return;
  }

  try {
    await pageAgent.invoke_addScriptToEvaluateOnNewDocument({
      source: SHADOW_PIERCER_RUNTIME,
      worldName: undefined, // Main world (not isolated)
      runImmediately: true,
    });
  } catch (error) {
    console.error('[ShadowPiercer] Failed to inject runtime script:', error);
  }
}

/**
 * Check if the shadow piercer is already installed in the target.
 */
export async function isPiercerInstalled(
    target: SDK.Target.Target,
    executionContextId?: number,
): Promise<boolean> {
  try {
    const runtimeAgent = target.runtimeAgent();
    const params: Protocol.Runtime.EvaluateRequest = {
      expression: 'window.__browserOperatorInjected === true',
      returnByValue: true,
    };
    if (executionContextId !== undefined) {
      params.contextId = executionContextId as Protocol.Runtime.ExecutionContextId;
    }
    const result = await runtimeAgent.invoke_evaluate(params);

    return result?.result?.value === true;
  } catch {
    return false;
  }
}

/**
 * Get the piercer stats from the target page.
 */
export async function getPiercerStats(
    target: SDK.Target.Target,
    executionContextId?: number,
): Promise<{installed: boolean; open: number; closed: number} | null> {
  try {
    const runtimeAgent = target.runtimeAgent();
    const params: Protocol.Runtime.EvaluateRequest = {
      expression: 'window.__browserOperator__?.stats()',
      returnByValue: true,
    };
    if (executionContextId !== undefined) {
      params.contextId = executionContextId as Protocol.Runtime.ExecutionContextId;
    }
    const result = await runtimeAgent.invoke_evaluate(params);

    const value = result?.result?.value;
    if (value && typeof value === 'object') {
      return {
        installed: (value as Record<string, unknown>).installed === true,
        open: ((value as Record<string, unknown>).open as number) ?? 0,
        closed: ((value as Record<string, unknown>).closed as number) ?? 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ensure the shadow piercer is injected before performing element operations.
 * This should be called before any operation that needs to access shadow DOM.
 */
export async function ensurePiercerInjected(
    target: SDK.Target.Target,
): Promise<void> {
  if (!(await isPiercerInstalled(target))) {
    await injectShadowPiercer(target);
  }
}
