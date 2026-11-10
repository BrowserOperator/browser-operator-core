// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Hybrid Accessibility Tree Tool
 *
 * An enhanced accessibility tree tool that uses the hybrid snapshot system
 * for frame-aware, shadow DOM-piercing accessibility tree capture.
 *
 * This tool returns EncodedId-based element identifiers that can be used
 * for precise cross-frame element targeting.
 */

import {captureHybridSnapshotUniversal, type HybridSnapshot} from '../a11y/HybridSnapshotUniversal.js';
import type {EncodedId} from '../common/context.js';
import type {Tool, LLMContext, ErrorResult} from './Tools.js';
import {getAdapter} from '../cdp/getAdapter.js';

/**
 * Arguments for the hybrid accessibility tree tool
 */
export interface HybridAccessibilityTreeArgs {
  /** Optional selector to focus on a specific subtree */
  focusSelector?: string;
  /** Whether to include shadow DOM (default: true) */
  pierceShadow?: boolean;
}

/**
 * Result of the hybrid accessibility tree tool
 */
export interface HybridAccessibilityTreeResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Human-readable accessibility tree */
  tree: string;
  /** Number of frames captured */
  frameCount: number;
  /** EncodedId -> XPath mapping for element targeting */
  elementMap: Record<EncodedId, string>;
  /** EncodedId -> URL mapping for links */
  urlMap: Record<EncodedId, string>;
  /** Metadata about the capture */
  metadata: {
    /** Whether shadow DOM piercing was used */
    piercedShadow: boolean;
    /** Whether a focus selector was applied */
    focusApplied: boolean;
    /** Total elements captured */
    elementCount: number;
  };
}

/**
 * Tool that captures a hybrid accessibility snapshot with EncodedId mapping.
 */
export class HybridAccessibilityTreeTool implements Tool<HybridAccessibilityTreeArgs, HybridAccessibilityTreeResult|ErrorResult> {
  name = 'get_hybrid_accessibility_tree';

  description = `Gets an enhanced accessibility tree that supports shadow DOM and cross-frame element targeting.
Returns a tree with EncodedId labels (format: "frameOrdinal-backendNodeId") that can be used to precisely target elements.
Use this when you need to interact with elements inside shadow DOM or iframes.`;

  schema = {
    type: 'object',
    properties: {
      focusSelector: {
        type: 'string',
        description: 'Optional CSS or XPath selector to focus on a specific subtree',
      },
      pierceShadow: {
        type: 'boolean',
        description: 'Whether to include shadow DOM elements (default: true)',
      },
    },
    required: [],
  };

  async execute(
      args: HybridAccessibilityTreeArgs,
      ctx?: LLMContext,
  ): Promise<HybridAccessibilityTreeResult|ErrorResult> {
    try {
      // Get adapter from context (works in both DevTools and eval runner)
      const adapter = await getAdapter(ctx);
      if (!adapter) {
        return {error: 'No browser connection available'};
      }

      const pierceShadow = args.pierceShadow ?? true;

      // Capture the hybrid snapshot using CDP (pierce:true handles shadow DOM natively)
      const snapshot = await captureHybridSnapshotUniversal(adapter, {
        focusSelector: args.focusSelector,
        pierceShadow,
      });

      // Cache the snapshot for EncodedId resolution by perform_action
      ResolveEncodedIdTool.setLastSnapshot(snapshot);

      const elementCount = Object.keys(snapshot.combinedXpathMap).length;

      return {
        success: true,
        tree: snapshot.combinedTree,
        frameCount: snapshot.perFrame.length,
        elementMap: snapshot.combinedXpathMap,
        urlMap: snapshot.combinedUrlMap,
        metadata: {
          piercedShadow: pierceShadow,
          focusApplied: !!args.focusSelector,
          elementCount,
        },
      };
    } catch (error) {
      return {
        error: `Failed to capture hybrid accessibility tree: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

/**
 * Tool for resolving an EncodedId to its XPath and performing actions.
 */
export class ResolveEncodedIdTool implements Tool<{encodedId: string}, {xpath: string; url?: string}|ErrorResult> {
  name = 'resolve_encoded_id';

  description = `Resolves an EncodedId (format: "frameOrdinal-backendNodeId") to its absolute XPath.
Use this after get_hybrid_accessibility_tree to get the XPath for an element you want to interact with.`;

  schema = {
    type: 'object',
    properties: {
      encodedId: {
        type: 'string',
        description: 'The EncodedId to resolve (format: "0-123")',
      },
    },
    required: ['encodedId'],
  };

  // Store the last snapshot for resolution
  private static lastSnapshot: HybridSnapshot|null = null;

  static setLastSnapshot(snapshot: HybridSnapshot): void {
    ResolveEncodedIdTool.lastSnapshot = snapshot;
  }

  static getLastSnapshot(): HybridSnapshot|null {
    return ResolveEncodedIdTool.lastSnapshot;
  }

  async execute(
      args: {encodedId: string},
      _ctx?: LLMContext,
  ): Promise<{xpath: string; url?: string}|ErrorResult> {
    const snapshot = ResolveEncodedIdTool.lastSnapshot;
    if (!snapshot) {
      return {error: 'No accessibility tree captured. Call get_hybrid_accessibility_tree first.'};
    }

    const xpath = snapshot.combinedXpathMap[args.encodedId as EncodedId];
    if (!xpath) {
      return {error: `EncodedId not found: ${args.encodedId}`};
    }

    const url = snapshot.combinedUrlMap[args.encodedId as EncodedId];
    return {xpath, url};
  }
}
