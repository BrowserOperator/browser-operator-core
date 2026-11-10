// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Mouse Helpers
 *
 * Shared utilities for dispatching mouse events via CDP.
 * Consolidates common patterns used in element interaction functions.
 */

import type {CDPSessionAdapter} from '../cdp/CDPSessionAdapter.js';
import {getQuadCenter} from './geometry-helpers.js';

/**
 * Result of resolving an element's center coordinates.
 */
export interface ElementCenter {
  x: number;
  y: number;
  backendNodeId: number;
}

/**
 * Get the center coordinates of an element from its objectId.
 * Handles the common pattern: describeNode -> getBoxModel -> getQuadCenter
 */
export async function getElementCenterFromObjectId(
    domAgent: ReturnType<CDPSessionAdapter['domAgent']>,
    objectId: string,
): Promise<ElementCenter> {
  const nodeResponse =
      await domAgent.invoke<{node?: {backendNodeId?: number}}>('describeNode', {objectId});
  if (!nodeResponse.node?.backendNodeId) {
    throw new Error(`Could not get backend node ID for element with objectId: ${objectId}`);
  }

  const backendNodeId = nodeResponse.node.backendNodeId;
  const boxModel =
      await domAgent.invoke<{model?: {content: number[]}}>('getBoxModel', {
        backendNodeId,
      });

  if (!boxModel.model) {
    throw new Error(`Could not get box model for element with objectId: ${objectId} (backendNodeId: ${backendNodeId})`);
  }

  const {x, y} = getQuadCenter(boxModel.model.content);
  return {x, y, backendNodeId};
}

/**
 * Get the center coordinates of an element from its backendNodeId.
 */
export async function getElementCenterFromBackendNodeId(
    domAgent: ReturnType<CDPSessionAdapter['domAgent']>,
    backendNodeId: number,
): Promise<{x: number; y: number}> {
  const boxModel = await domAgent.invoke<{model?: {content: number[]}}>('getBoxModel', {
    backendNodeId,
  });

  if (!boxModel.model) {
    throw new Error(`Could not get box model for backendNodeId ${backendNodeId}`);
  }

  return getQuadCenter(boxModel.model.content);
}

/**
 * Dispatch a click (press + release) at the specified coordinates.
 */
export async function dispatchClick(
    inputAgent: ReturnType<CDPSessionAdapter['inputAgent']>,
    x: number,
    y: number,
    button: 'left' | 'right' = 'left',
): Promise<void> {
  await inputAgent.invoke('dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button,
    clickCount: 1,
  });

  await inputAgent.invoke('dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button,
    clickCount: 1,
  });
}

/**
 * Dispatch a mouse move to the specified coordinates.
 */
export async function dispatchMouseMove(
    inputAgent: ReturnType<CDPSessionAdapter['inputAgent']>,
    x: number,
    y: number,
): Promise<void> {
  await inputAgent.invoke('dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
  });
}

/**
 * Dispatch a drag operation with animated movement.
 */
export async function dispatchDrag(
    inputAgent: ReturnType<CDPSessionAdapter['inputAgent']>,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    options: {steps?: number; stepDelayMs?: number} = {},
): Promise<void> {
  const {steps = 10, stepDelayMs = 10} = options;

  // Press at start position
  await inputAgent.invoke('dispatchMouseEvent', {
    type: 'mousePressed',
    x: startX,
    y: startY,
    button: 'left',
    clickCount: 1,
  });

  // Animate movement
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const currentX = startX + (endX - startX) * progress;
    const currentY = startY + (endY - startY) * progress;

    await inputAgent.invoke('dispatchMouseEvent', {
      type: 'mouseMoved',
      x: currentX,
      y: currentY,
      button: 'left',
    });

    await new Promise(resolve => setTimeout(resolve, stepDelayMs));
  }

  // Release at end position
  await inputAgent.invoke('dispatchMouseEvent', {
    type: 'mouseReleased',
    x: endX,
    y: endY,
    button: 'left',
    clickCount: 1,
  });
}
