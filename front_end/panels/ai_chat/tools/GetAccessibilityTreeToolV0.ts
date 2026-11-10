// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * V0 (Baseline) version of GetAccessibilityTreeTool
 *
 * Extracted from git commit 634a6b2f70 (original implementation).
 *
 * Key differences from current (v1):
 * - Simple interface: { reasoning: string } only
 * - No searchQuery, focusElementId, chunkIndex, fullPage parameters
 * - Returns full accessibility tree always (no chunking)
 * - No search functionality
 *
 * Adapted to use CDP adapter pattern for eval runner compatibility.
 */

import { createLogger } from "../core/Logger.js";
import { getAdapter } from "../cdp/getAdapter.js";
import * as UtilsUniversal from "../common/utils-universal.js";
import type { Tool, LLMContext, AccessibilityTreeResult, ErrorResult } from "./Tools.js";

const logger = createLogger("GetAccessibilityTreeToolV0");

/**
 * V0 Tool for getting the accessibility tree of the current page.
 * Original implementation with simple interface, adapted for CDP adapter.
 */
export class GetAccessibilityTreeToolV0 implements Tool<{ reasoning: string }, AccessibilityTreeResult | ErrorResult> {
  name = 'get_page_content';
  description = 'V0 BASELINE: Gets the accessibility tree of the current page, providing a hierarchical structure of all accessible elements. Simple interface without search, focus, or chunking features.';

  async execute(args: { reasoning: string }, ctx?: LLMContext): Promise<AccessibilityTreeResult | ErrorResult> {
    try {
      logger.warn(`[V0] Getting accessibility tree: ${args.reasoning}`);

      const adapter = await getAdapter(ctx);
      if (!adapter) {
        return { error: 'No browser connection available' };
      }

      // Original v0 implementation: just get the full tree, no chunking or search
      const treeResult = await UtilsUniversal.getAccessibilityTree(adapter);

      return {
        simplified: treeResult.simplified,
        idToUrl: treeResult.idToUrl,
      };
    } catch (error) {
      return { error: `Failed to get accessibility tree: ${String(error)}` };
    }
  }

  schema = {
    type: 'object',
    properties: {
      reasoning: {
        type: 'string',
        description: 'The reasoning behind why the accessibility tree is needed',
      },
    },
    required: ['reasoning'],
  };
}
