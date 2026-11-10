// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Frame Registry
 *
 * Tracks frame hierarchy with stable ordinals for EncodedId generation.
 * Each frame gets a unique ordinal assigned during DFS traversal, which
 * is combined with backend node IDs to create globally unique element identifiers.
 *
 */

import * as SDK from '../../../core/sdk/sdk.js';

/**
 * Information about a single frame
 */
export interface FrameInfo {
  /** Stable index for EncodedId generation (assigned during DFS) */
  ordinal: number;
  /** CDP frame ID */
  frameId: string;
  /** Target ID for OOPIF (out-of-process iframe) targets */
  targetId?: string;
  /** Parent frame ID (undefined for main frame) */
  parentFrameId?: string;
  /** Frame URL */
  url: string;
  /** Backend node ID of the <iframe> element in the parent frame */
  ownerBackendNodeId?: number;
  /** Absolute XPath to the <iframe> element in the parent frame */
  ownerXPath?: string;
}

/**
 * Registry for tracking frame hierarchy with stable ordinals.
 */
export class FrameRegistry {
  private frames = new Map<string, FrameInfo>();
  private nextOrdinal = 0;
  private mainFrameId: string|null = null;

  constructor(private target: SDK.Target.Target) {}

  /**
   * Collect all frames from the target and assign ordinals.
   * Returns frames in DFS order (main frame first, then children).
   */
  async collectFrames(): Promise<FrameInfo[]> {
    this.frames.clear();
    this.nextOrdinal = 0;
    this.mainFrameId = null;

    const resourceTreeModel = this.target.model(SDK.ResourceTreeModel.ResourceTreeModel);
    if (!resourceTreeModel) {
      return [];
    }

    const mainFrame = resourceTreeModel.mainFrame;
    if (!mainFrame) {
      return [];
    }

    this.mainFrameId = mainFrame.id;

    // DFS traversal to assign ordinals in document order
    const visit = async(
        frame: SDK.ResourceTreeModel.ResourceTreeFrame,
        parentId?: string,
    ): Promise<void> => {
      const info: FrameInfo = {
        ordinal: this.nextOrdinal++,
        frameId: frame.id,
        parentFrameId: parentId,
        url: frame.url,
      };

      // Get owner iframe backendNodeId if not main frame
      if (parentId) {
        try {
          const domAgent = this.target.domAgent();
          if (domAgent) {
            const response = await domAgent.invoke_getFrameOwner({frameId: frame.id});
            if (response && !response.getError() && response.backendNodeId) {
              info.ownerBackendNodeId = response.backendNodeId;
            }
          }
        } catch {
          // Frame may have been removed or OOPIF ownership may be different
        }
      }

      this.frames.set(frame.id, info);

      // Process child frames recursively
      for (const child of frame.childFrames) {
        await visit(child, frame.id);
      }
    };

    await visit(mainFrame);
    return Array.from(this.frames.values());
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
  getFrame(frameId: string): FrameInfo|undefined {
    return this.frames.get(frameId);
  }

  /**
   * Get frame info by ordinal.
   */
  getFrameByOrdinal(ordinal: number): FrameInfo|undefined {
    for (const frame of this.frames.values()) {
      if (frame.ordinal === ordinal) {
        return frame;
      }
    }
    return undefined;
  }

  /**
   * Get parent frame ID for a given frame.
   */
  getParentFrameId(frameId: string): string|undefined {
    return this.frames.get(frameId)?.parentFrameId;
  }

  /**
   * Get the main frame ID.
   */
  getMainFrameId(): string|null {
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
   * Build a map of frameId -> parentFrameId (or null for main frame).
   */
  getParentMap(): Map<string, string|null> {
    const map = new Map<string, string|null>();
    for (const [frameId, info] of this.frames) {
      map.set(frameId, info.parentFrameId ?? null);
    }
    return map;
  }

  /**
   * Get child frame IDs for a given parent frame.
   */
  getChildFrameIds(parentFrameId: string): string[] {
    const children: string[] = [];
    for (const [frameId, info] of this.frames) {
      if (info.parentFrameId === parentFrameId) {
        children.push(frameId);
      }
    }
    return children;
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
