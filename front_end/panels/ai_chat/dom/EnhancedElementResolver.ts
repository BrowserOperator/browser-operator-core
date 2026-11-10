// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Enhanced Element Resolver
 *
 * Provides enhanced element resolution for actions that supports:
 * - Shadow DOM (closed and open)
 * - Cross-frame element targeting
 * - EncodedId-based resolution
 *
 * This module bridges the existing action system with the new
 * composed tree resolver and shadow piercer.
 */

import * as SDK from '../../../core/sdk/sdk.js';
import type * as Protocol from '../../../generated/protocol.js';

import {ensurePiercerInjected, getPiercerStats} from './ShadowPiercer.js';
import {resolveComposedXPath, resolveComposedCss, type ResolvedElement} from './ComposedTreeResolver.js';
import {parseEncodedId, type EncodedId} from '../common/context.js';
import {FrameRegistry} from '../a11y/FrameRegistry.js';

/**
 * Result of enhanced element resolution
 */
export interface EnhancedResolutionResult {
  /** Whether the element was found */
  found: boolean;
  /** Runtime object ID */
  objectId?: string;
  /** Backend node ID */
  backendNodeId?: number;
  /** Frame ID where the element is located */
  frameId?: string;
  /** Whether shadow piercer was used */
  usedShadowPiercer: boolean;
  /** Error message if resolution failed */
  error?: string;
}

/**
 * Type for resolver functions
 */
type SelectorResolverFunction = (
  target: SDK.Target.Target,
  selector: string,
) => Promise<ResolvedElement | null>;

/**
 * Common resolution logic with piercer injection and error handling.
 */
async function resolveWithPiercerEnhanced(
  target: SDK.Target.Target,
  selector: string,
  resolverFn: SelectorResolverFunction,
  selectorType: string,
  options: {ensurePiercer?: boolean} = {},
): Promise<EnhancedResolutionResult> {
  const {ensurePiercer = true} = options;

  try {
    if (ensurePiercer) {
      await ensurePiercerInjected(target);
    }

    const stats = await getPiercerStats(target);
    const usedShadowPiercer = stats?.installed === true;

    const result = await resolverFn(target, selector);

    if (!result) {
      return {
        found: false,
        usedShadowPiercer,
        error: `Element not found for ${selectorType}: ${selector}`,
      };
    }

    return {
      found: true,
      objectId: result.objectId,
      backendNodeId: result.backendNodeId,
      usedShadowPiercer,
    };
  } catch (error) {
    return {
      found: false,
      usedShadowPiercer: false,
      error: `${selectorType} resolution failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Resolve an element by EncodedId.
 * The EncodedId format is "frameOrdinal-backendNodeId".
 *
 * @param target - The SDK target
 * @param encodedId - The encoded element ID
 * @param cachedRegistry - Optional pre-built FrameRegistry to avoid expensive recreation
 */
export async function resolveByEncodedId(
  target: SDK.Target.Target,
  encodedId: EncodedId | string,
  cachedRegistry?: FrameRegistry,
): Promise<EnhancedResolutionResult> {
  const parsed = parseEncodedId(encodedId);
  if (!parsed) {
    return {
      found: false,
      usedShadowPiercer: false,
      error: `Invalid EncodedId format: ${encodedId}`,
    };
  }

  const {frameOrdinal, backendNodeId} = parsed;

  try {
    // Use cached registry or build a new one
    const frameRegistry = cachedRegistry ?? new FrameRegistry(target);
    if (!cachedRegistry) {
      await frameRegistry.collectFrames();
    }

    const frameInfo = frameRegistry.getFrameByOrdinal(frameOrdinal);
    if (!frameInfo) {
      return {
        found: false,
        usedShadowPiercer: false,
        error: `Frame with ordinal ${frameOrdinal} not found`,
      };
    }

    // Resolve the node by backend ID
    // Note: For cross-frame resolution in OOPIFs, executionContextId may be needed.
    // However, backendNodeId is globally unique and should resolve correctly
    // in most cases. If issues arise with OOPIF elements, consider adding
    // executionContextId to FrameInfo and passing it here.
    const domAgent = target.domAgent();
    const resolveResponse = await domAgent.invoke_resolveNode({
      backendNodeId: backendNodeId as Protocol.DOM.BackendNodeId,
    });

    if (!resolveResponse.object?.objectId) {
      return {
        found: false,
        usedShadowPiercer: false,
        error: `Could not resolve backend node ${backendNodeId} in frame ${frameInfo.frameId}`,
      };
    }

    return {
      found: true,
      objectId: resolveResponse.object.objectId,
      backendNodeId,
      frameId: frameInfo.frameId,
      usedShadowPiercer: false,
    };
  } catch (error) {
    return {
      found: false,
      usedShadowPiercer: false,
      error: `Resolution failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Resolve an element by XPath, using the composed tree resolver
 * for shadow DOM support.
 */
export async function resolveByXPathEnhanced(
  target: SDK.Target.Target,
  xpath: string,
  options: {ensurePiercer?: boolean} = {},
): Promise<EnhancedResolutionResult> {
  return resolveWithPiercerEnhanced(target, xpath, resolveComposedXPath, 'XPath', options);
}

/**
 * Resolve an element by CSS selector, using the composed tree resolver
 * for shadow DOM support.
 */
export async function resolveByCssSelectorEnhanced(
  target: SDK.Target.Target,
  selector: string,
  options: {ensurePiercer?: boolean} = {},
): Promise<EnhancedResolutionResult> {
  return resolveWithPiercerEnhanced(target, selector, resolveComposedCss, 'selector', options);
}

/**
 * Resolve an element by backend node ID, with optional shadow piercer
 * injection for subsequent operations.
 */
export async function resolveByBackendNodeId(
  target: SDK.Target.Target,
  backendNodeId: number,
  options: {ensurePiercer?: boolean} = {},
): Promise<EnhancedResolutionResult> {
  const {ensurePiercer = true} = options;

  try {
    // Optionally ensure shadow piercer is injected for later operations
    if (ensurePiercer) {
      await ensurePiercerInjected(target);
    }

    const domAgent = target.domAgent();
    const resolveResponse = await domAgent.invoke_resolveNode({
      backendNodeId: backendNodeId as Protocol.DOM.BackendNodeId,
    });

    if (!resolveResponse.object?.objectId) {
      return {
        found: false,
        usedShadowPiercer: false,
        error: `Could not resolve backend node ${backendNodeId}`,
      };
    }

    return {
      found: true,
      objectId: resolveResponse.object.objectId,
      backendNodeId,
      usedShadowPiercer: ensurePiercer,
    };
  } catch (error) {
    return {
      found: false,
      usedShadowPiercer: false,
      error: `Backend node resolution failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Smart resolver that detects the selector type and uses the appropriate
 * resolution method.
 */
export async function resolveElementSmart(
  target: SDK.Target.Target,
  selector: string,
  options: {ensurePiercer?: boolean} = {},
): Promise<EnhancedResolutionResult> {
  const trimmed = selector.trim();

  // Check for EncodedId format (e.g., "0-123")
  if (/^\d+-\d+$/.test(trimmed)) {
    return resolveByEncodedId(target, trimmed as EncodedId);
  }

  // Check for XPath (starts with / or xpath=)
  if (trimmed.startsWith('/') || trimmed.toLowerCase().startsWith('xpath=')) {
    return resolveByXPathEnhanced(target, trimmed, options);
  }

  // Check for numeric backend node ID
  if (/^\d+$/.test(trimmed)) {
    return resolveByBackendNodeId(target, parseInt(trimmed, 10), options);
  }

  // Default to CSS selector
  return resolveByCssSelectorEnhanced(target, trimmed, options);
}
