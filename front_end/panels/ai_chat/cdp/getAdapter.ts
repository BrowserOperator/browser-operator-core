// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Helper to get CDP adapter from context or SDK
 *
 * Tools should use this helper instead of directly accessing SDK.TargetManager.
 * This enables tools to work in both DevTools context and eval runner context.
 */

import type { CDPSessionAdapter } from './CDPSessionAdapter.js';

// Detect if we're in a Node.js environment (eval runner, tests)
const isNodeEnvironment = typeof window === 'undefined' || typeof document === 'undefined';

/**
 * Browser dependencies loaded via lazy promise
 */
interface BrowserDeps {
  SDK: typeof import('../../../core/sdk/sdk.js');
  SDKTargetAdapter: typeof import('./SDKTargetAdapter.js').SDKTargetAdapter;
}

// Single lazy promise for browser dependencies - initialized once on first access
let browserDepsPromise: Promise<BrowserDeps | null> | null = null;
let browserDepsResult: BrowserDeps | null = null;

/**
 * Lazily load browser dependencies.
 * Returns cached result after first successful load.
 */
function loadBrowserDeps(): Promise<BrowserDeps | null> {
  if (isNodeEnvironment) {
    return Promise.resolve(null);
  }

  if (!browserDepsPromise) {
    browserDepsPromise = Promise.all([
      import('../../../core/sdk/sdk.js'),
      import('./SDKTargetAdapter.js'),
    ]).then(([sdkModule, adapterModule]) => {
      browserDepsResult = {
        SDK: sdkModule,
        SDKTargetAdapter: adapterModule.SDKTargetAdapter,
      };
      return browserDepsResult;
    }).catch(() => {
      // Reset promise so we can retry on failure
      browserDepsPromise = null;
      return null;
    });
  }

  return browserDepsPromise;
}

/**
 * Context that may contain a CDP adapter
 */
export interface AdapterContext {
  cdpAdapter?: CDPSessionAdapter;
}

/**
 * Get the CDP adapter from context, falling back to SDK.Target for DevTools context.
 * This is an async function that lazily loads SDK dependencies.
 *
 * @param ctx - Optional context that may contain a cdpAdapter
 * @returns CDPSessionAdapter or null if no adapter is available
 *
 * @example
 * ```typescript
 * async execute(args: any, ctx?: LLMContext) {
 *   const adapter = await getAdapter(ctx);
 *   if (!adapter) {
 *     return { error: 'No browser connection available' };
 *   }
 *   const tree = await getAccessibilityTree(adapter);
 *   // ...
 * }
 * ```
 */
export async function getAdapter(ctx?: AdapterContext): Promise<CDPSessionAdapter | null> {
  // First try to get adapter from context (for eval runner / external contexts)
  if (ctx?.cdpAdapter) {
    return ctx.cdpAdapter;
  }

  // Load browser dependencies
  const deps = await loadBrowserDeps();
  if (!deps) {
    return null;
  }

  // Fall back to SDK.Target for DevTools context
  const target = deps.SDK.TargetManager.TargetManager.instance().primaryPageTarget();
  if (!target) {
    return null;
  }

  return new deps.SDKTargetAdapter(target);
}

/**
 * Get the CDP adapter synchronously if browser dependencies are already loaded.
 * Returns null if dependencies haven't been loaded yet or no adapter is available.
 *
 * Use this when you need sync access and have already called getAdapter() elsewhere.
 * Prefer getAdapter() for most use cases.
 *
 * @param ctx - Optional context that may contain a cdpAdapter
 * @returns CDPSessionAdapter or null
 */
export function getAdapterIfLoaded(ctx?: AdapterContext): CDPSessionAdapter | null {
  // First try to get adapter from context (for eval runner / external contexts)
  if (ctx?.cdpAdapter) {
    return ctx.cdpAdapter;
  }

  // Return null if deps not loaded yet
  if (!browserDepsResult) {
    return null;
  }

  // Fall back to SDK.Target for DevTools context
  const target = browserDepsResult.SDK.TargetManager.TargetManager.instance().primaryPageTarget();
  if (!target) {
    return null;
  }

  return new browserDepsResult.SDKTargetAdapter(target);
}

/**
 * Preload browser dependencies.
 * Call this early to ensure getAdapterIfLoaded() will work.
 * Returns true if dependencies loaded successfully.
 */
export async function preloadBrowserDeps(): Promise<boolean> {
  const deps = await loadBrowserDeps();
  return deps !== null;
}
