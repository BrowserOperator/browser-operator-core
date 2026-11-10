// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Frame Registry Universal
 *
 * Adapter-compatible version of FrameRegistry that works with CDPSessionAdapter.
 * Tracks frame hierarchy with stable ordinals for EncodedId generation.
 */

import type {CDPSessionAdapter} from './CDPSessionAdapter.js';

/**
 * Information about a single frame
 */
export interface FrameInfo {
  /** Stable index for EncodedId generation (assigned during DFS) */
  ordinal: number;
  /** CDP frame ID */
  frameId: string;
  /** Parent frame ID (undefined for main frame) */
  parentFrameId?: string;
  /** Frame URL */
  url: string;
  /** Backend node ID of the <iframe> element in the parent frame */
  ownerBackendNodeId?: number;
}

/**
 * Registry for tracking frame hierarchy with stable ordinals.
 * Uses CDPSessionAdapter for compatibility with both DevTools and eval runner.
 */
export class FrameRegistryUniversal {
  private frames = new Map<string, FrameInfo>();
  private nextOrdinal = 0;
  private mainFrameId: string | null = null;

  // Secondary indexes for O(1) lookups
  private ordinalToFrameId = new Map<number, string>();
  private childrenByParent = new Map<string, string[]>();

  constructor(private adapter: CDPSessionAdapter) {}

  /**
   * Collect all frames from the target and assign ordinals.
   * Returns frames in DFS order (main frame first, then children).
   */
  async collectFrames(): Promise<FrameInfo[]> {
    this.frames.clear();
    this.ordinalToFrameId.clear();
    this.childrenByParent.clear();
    this.nextOrdinal = 0;
    this.mainFrameId = null;

    try {
      const pageAgent = this.adapter.pageAgent();
      const response = await pageAgent.invoke<{frameTree: FrameTreeNode}>('getFrameTree', {});

      if (!response.frameTree) {
        return [];
      }

      this.mainFrameId = response.frameTree.frame.id;

      // DFS traversal to assign ordinals in document order
      await this.visitFrame(response.frameTree);

      return Array.from(this.frames.values());
    } catch (error) {
      console.warn('[FrameRegistryUniversal] Failed to collect frames:', error);
      return [];
    }
  }

  /**
   * Recursively visit a frame tree node and assign ordinals.
   */
  private async visitFrame(node: FrameTreeNode, parentId?: string): Promise<void> {
    const info: FrameInfo = {
      ordinal: this.nextOrdinal++,
      frameId: node.frame.id,
      parentFrameId: parentId,
      url: node.frame.url || '',
    };

    // Get owner iframe backendNodeId if not main frame
    if (parentId) {
      try {
        const domAgent = this.adapter.domAgent();
        const response = await domAgent.invoke<{backendNodeId?: number; nodeId?: number}>(
          'getFrameOwner',
          {frameId: node.frame.id},
        );
        if (response.backendNodeId) {
          info.ownerBackendNodeId = response.backendNodeId;
        }
      } catch {
        // Frame may have been removed or ownership query failed
      }
    }

    this.frames.set(node.frame.id, info);

    // Build secondary indexes
    this.ordinalToFrameId.set(info.ordinal, node.frame.id);
    if (parentId) {
      const siblings = this.childrenByParent.get(parentId) || [];
      siblings.push(node.frame.id);
      this.childrenByParent.set(parentId, siblings);
    }

    // Process child frames recursively
    if (node.childFrames) {
      for (const child of node.childFrames) {
        await this.visitFrame(child, node.frame.id);
      }
    }
  }

  /**
   * Get the ordinal for a frame (0 for main frame).
   */
  getOrdinal(frameId: string): number {
    return this.frames.get(frameId)?.ordinal ?? 0;
  }

  /**
   * Get frame info by frame ID.
   */
  getFrame(frameId: string): FrameInfo | undefined {
    return this.frames.get(frameId);
  }

  /**
   * Get frame info by ordinal (O(1) indexed lookup).
   */
  getFrameByOrdinal(ordinal: number): FrameInfo | undefined {
    const frameId = this.ordinalToFrameId.get(ordinal);
    return frameId ? this.frames.get(frameId) : undefined;
  }

  /**
   * Get parent frame ID for a given frame.
   */
  getParentFrameId(frameId: string): string | undefined {
    return this.frames.get(frameId)?.parentFrameId;
  }

  /**
   * Get the main frame ID.
   */
  getMainFrameId(): string | null {
    return this.mainFrameId;
  }

  /**
   * List all frame IDs in ordinal order (main frame first).
   */
  listAllFrameIds(): string[] {
    return Array.from(this.frames.values())
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(f => f.frameId);
  }

  /**
   * Build a map of frameId -> parentFrameId (or undefined for main frame).
   */
  getParentMap(): Map<string, string | undefined> {
    const map = new Map<string, string | undefined>();
    for (const [frameId, info] of this.frames) {
      map.set(frameId, info.parentFrameId);
    }
    return map;
  }

  /**
   * Get child frame IDs for a given parent frame (O(1) indexed lookup).
   */
  getChildFrameIds(parentFrameId: string): string[] {
    return this.childrenByParent.get(parentFrameId) || [];
  }

  /**
   * Get frame info by the owner iframe's backendNodeId.
   * This is useful when traversing DOM and encountering an iframe element.
   * @param ownerBackendNodeId The backendNodeId of the iframe element
   * @returns FrameInfo for the frame owned by this iframe, or undefined
   */
  getFrameByOwnerBackendNodeId(ownerBackendNodeId: number): FrameInfo | undefined {
    for (const frame of this.frames.values()) {
      if (frame.ownerBackendNodeId === ownerBackendNodeId) {
        return frame;
      }
    }
    return undefined;
  }

  /**
   * Check if a frame exists in the registry.
   */
  hasFrame(frameId: string): boolean {
    return this.frames.has(frameId);
  }

  /**
   * Get the total number of frames.
   */
  get frameCount(): number {
    return this.frames.size;
  }
}

/**
 * CDP Frame tree node structure from Page.getFrameTree
 */
interface FrameTreeNode {
  frame: {
    id: string;
    parentId?: string;
    loaderId?: string;
    name?: string;
    url: string;
    securityOrigin?: string;
    mimeType?: string;
  };
  childFrames?: FrameTreeNode[];
}
