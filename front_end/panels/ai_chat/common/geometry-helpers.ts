// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Geometry helper functions for DOM element positioning.
 *
 * These utilities work with CDP box model quad coordinates.
 * A quad is represented as 8 numbers: [x1, y1, x2, y2, x3, y3, x4, y4]
 * representing the four corners of a quadrilateral.
 */

/**
 * Calculates the center point of a quad (box model content, padding, border, or margin).
 *
 * The quad format from CDP is: [x1, y1, x2, y2, x3, y3, x4, y4]
 * representing top-left, top-right, bottom-right, bottom-left corners.
 *
 * @param quad - Array of 8 numbers representing quad corners
 * @returns Center point {x, y} coordinates
 */
export function getQuadCenter(quad: number[]): {x: number; y: number} {
  return {
    x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
    y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4,
  };
}

/**
 * Calculates the bounding box of a quad.
 *
 * @param quad - Array of 8 numbers representing quad corners
 * @returns Bounding box {x, y, width, height}
 */
export function getQuadBounds(quad: number[]): {x: number; y: number; width: number; height: number} {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
