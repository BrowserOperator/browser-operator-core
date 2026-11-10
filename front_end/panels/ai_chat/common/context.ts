// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type * as SDK from '../../../core/sdk/sdk.js';
import type * as Protocol from '../../../generated/protocol.js';

import type { Page } from './page.js';

export interface AXNode {
  role?: { value: string };
  name?: { value: string };
  description?: { value: string };
  value?: { value: string };
  nodeId: string;
  backendDOMNodeId?: number;
  parentId?: string;
  childIds?: string[];
}

export interface AccessibilityNode {
  role: string;
  name?: string;
  description?: string;
  value?: string;
  children?: AccessibilityNode[];
  childIds?: string[];
  parentId?: string;
  nodeId?: string;
  backendDOMNodeId?: number;
  properties?: Protocol.Accessibility.AXProperty[];
}

// Enhanced interface for iframe node with content tree
export interface IFrameAccessibilityNode extends AccessibilityNode {
  contentTree?: AccessibilityNode[];
  contentSimplified?: string;
}

// Backend ID mappings for DOM nodes
export interface BackendIdMaps {
  tagNameMap: Record<number, string>;
  xpathMap: Record<number, string>;
}

export interface TreeResult {
  tree: AccessibilityNode[];
  simplified: string;
  iframes: IFrameAccessibilityNode[];
  scrollableContainerNodes: Array<{nodeId: string, role: string, backendDOMNodeId?: number, name?: string}>;
  idToUrl?: Record<string, string>;
  xpathMap?: Record<number, string>;
  tagNameMap?: Record<number, string>;
  nodeIdToBackendId?: Record<string, number>;
}

export interface EnhancedContext extends SDK.Target.Target {
  setActivePage(page: Page): void;
  getActivePage(): Page | undefined;
  isPageActive(page: Page): boolean;
  executeForActivePageIfAvailable<T>(
    callback: (page: Page) => T,
  ): T | undefined;
}

// ============================================================================
// EncodedId System for Frame-Aware Element Identification
// ============================================================================

/**
 * EncodedId format: "frameOrdinal-backendNodeId"
 * This provides a globally unique identifier for any DOM element across all frames.
 *
 * - frameOrdinal: A stable index (0-based) assigned to each frame during DFS traversal.
 *   The main frame always has ordinal 0.
 * - backendNodeId: The CDP backend node ID for the element within its frame.
 *
 * Example: "0-42" = element with backendNodeId 42 in the main frame (ordinal 0)
 *          "2-156" = element with backendNodeId 156 in the third frame (ordinal 2)
 */
export type EncodedId = `${number}-${number}`;

/**
 * Create an EncodedId from frame ordinal and backend node ID.
 */
export function makeEncodedId(frameOrdinal: number, backendNodeId: number): EncodedId {
  return `${frameOrdinal}-${backendNodeId}`;
}

/**
 * Parse an EncodedId back into its components.
 */
export function parseEncodedId(encodedId: string): {frameOrdinal: number; backendNodeId: number} | null {
  const match = encodedId.match(/^(\d+)-(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    frameOrdinal: parseInt(match[1], 10),
    backendNodeId: parseInt(match[2], 10),
  };
}

/**
 * Check if a string is a valid EncodedId format.
 */
export function isEncodedId(value: string): value is EncodedId {
  return /^\d+-\d+$/.test(value);
}

/**
 * Enhanced backend ID maps using EncodedId for frame-aware element targeting.
 */
export interface EncodedIdMaps {
  /** EncodedId -> tag name */
  tagNameMap: Record<EncodedId, string>;
  /** EncodedId -> absolute XPath (including iframe prefixes) */
  xpathMap: Record<EncodedId, string>;
  /** EncodedId -> URL (for links) */
  urlMap: Record<EncodedId, string>;
  /** EncodedId -> whether element is scrollable */
  scrollableMap: Record<EncodedId, boolean>;
}
