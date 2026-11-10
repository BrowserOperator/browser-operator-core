// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Element Resolver
 *
 * High-level utilities for resolving elements using the shadow piercer
 * and composed tree resolver. This module provides the main integration
 * point for tools that need to interact with shadow DOM elements.
 */

import * as SDK from '../../../core/sdk/sdk.js';

import {ensurePiercerInjected, getPiercerStats} from './ShadowPiercer.js';
import {
  parseHopNotation,
  resolveComposedXPath,
  resolveComposedCss,
  resolveSelector,
  type ResolvedElement,
} from './ComposedTreeResolver.js';

/**
 * Options for element resolution
 */
export interface ResolveOptions {
  /** Ensure shadow piercer is injected before resolution */
  ensurePiercer?: boolean;
  /** Execution context ID for frame-specific resolution */
  executionContextId?: number;
}

/**
 * Result of element resolution with additional metadata
 */
export interface ElementResolutionResult extends ResolvedElement {
  /** Whether the element was found */
  found: boolean;
  /** The selector that was used */
  selector: string;
  /** Whether shadow piercer was used */
  usedPiercer: boolean;
  /** Error message if resolution failed */
  error?: string;
}

/**
 * Type for resolver functions that can be used with resolveWithPiercer
 */
type ResolverFunction = (
  target: SDK.Target.Target,
  selector: string,
  executionContextId?: number,
) => Promise<ResolvedElement | null>;

/**
 * Common resolution logic with piercer injection and error handling.
 * Extracts the shared pattern from resolveElement, resolveXPath, and resolveCssSelector.
 */
async function resolveWithPiercer(
  target: SDK.Target.Target,
  selector: string,
  resolverFn: ResolverFunction,
  selectorType: string,
  options: ResolveOptions = {},
): Promise<ElementResolutionResult> {
  const {ensurePiercer = true, executionContextId} = options;

  try {
    if (ensurePiercer) {
      await ensurePiercerInjected(target);
    }

    const stats = await getPiercerStats(target, executionContextId);
    const usedPiercer = stats?.installed === true;

    const result = await resolverFn(target, selector, executionContextId);

    if (!result) {
      return {
        found: false,
        selector,
        usedPiercer,
        error: `${selectorType} not found: ${selector}`,
      };
    }

    return {
      found: true,
      selector,
      usedPiercer,
      objectId: result.objectId,
      backendNodeId: result.backendNodeId,
    };
  } catch (error) {
    return {
      found: false,
      selector,
      usedPiercer: false,
      error: `${selectorType} resolution failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Resolve an element by selector with full shadow DOM support.
 * Supports both XPath and CSS selectors, including >> hop notation.
 */
export async function resolveElement(
  target: SDK.Target.Target,
  selector: string,
  options: ResolveOptions = {},
): Promise<ElementResolutionResult> {
  // Parse hop notation if present
  const {frameHops, finalSelector} = parseHopNotation(selector);

  // If there are frame hops, we need to traverse iframes
  // For now, we only support direct resolution (hop support to be added)
  if (frameHops.length > 0) {
    return {
      found: false,
      selector,
      usedPiercer: false,
      error: 'Iframe hop notation (>>) not yet implemented for element resolution',
    };
  }

  return resolveWithPiercer(target, finalSelector, resolveSelector, 'Element', options);
}

/**
 * Resolve an XPath selector with shadow DOM support.
 */
export async function resolveXPath(
  target: SDK.Target.Target,
  xpath: string,
  options: ResolveOptions = {},
): Promise<ElementResolutionResult> {
  return resolveWithPiercer(target, xpath, resolveComposedXPath, 'XPath', options);
}

/**
 * Resolve a CSS selector with shadow DOM support.
 */
export async function resolveCssSelector(
  target: SDK.Target.Target,
  cssSelector: string,
  options: ResolveOptions = {},
): Promise<ElementResolutionResult> {
  return resolveWithPiercer(target, cssSelector, resolveComposedCss, 'CSS selector', options);
}

// Re-export commonly used functions
export {ensurePiercerInjected, getPiercerStats} from './ShadowPiercer.js';
export {parseHopNotation} from './ComposedTreeResolver.js';
