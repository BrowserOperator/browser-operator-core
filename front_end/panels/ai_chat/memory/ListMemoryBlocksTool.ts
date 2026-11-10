// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../core/Logger.js';
import type { Tool, LLMContext } from '../tools/Tools.js';
import { MemoryBlockManager } from './MemoryBlockManager.js';

const logger = createLogger('Tool:ListMemoryBlocks');

export interface ListMemoryBlocksArgs {
  // No arguments needed
}

export interface ListMemoryBlocksResult {
  success: boolean;
  blocks: Array<{
    type: string;
    label: string;
    content: string;
    charCount: number;
    charLimit: number;
    updatedAt: string;
  }>;
  summary: {
    totalBlocks: number;
    totalChars: number;
    maxChars: number;
  };
  error?: string;
}

/**
 * Tool for listing all memory blocks with their content and metadata.
 * Useful for the MemoryAgent to see current memory state before making updates.
 */
export class ListMemoryBlocksTool implements Tool<ListMemoryBlocksArgs, ListMemoryBlocksResult> {
  name = 'list_memory_blocks';
  description = 'List all memory blocks with their current content and metadata (size, limits, last updated). Use this to see the current state of memory before making updates.';

  schema = {
    type: 'object',
    properties: {},
    required: []
  };

  async execute(_args: ListMemoryBlocksArgs, _ctx?: LLMContext): Promise<ListMemoryBlocksResult> {
    logger.info('Executing list memory blocks');

    // Calculate max capacity: 20000 (user) + 20000 (facts) + 4*20000 (projects)
    const maxChars = 120000;

    try {
      const manager = new MemoryBlockManager();
      const blocks = await manager.getAllBlocks();

      const formattedBlocks = blocks.map(b => ({
        type: b.type,
        label: b.label,
        content: b.content,
        charCount: b.content.length,
        charLimit: b.charLimit,
        updatedAt: new Date(b.updatedAt).toISOString()
      }));

      const summary = {
        totalBlocks: blocks.length,
        totalChars: blocks.reduce((sum, b) => sum + b.content.length, 0),
        maxChars
      };

      logger.info('Listed memory blocks', { blockCount: blocks.length, totalChars: summary.totalChars });

      return {
        success: true,
        blocks: formattedBlocks,
        summary
      };
    } catch (error: any) {
      logger.error('Failed to list memory blocks', { error: error?.message });
      return {
        success: false,
        blocks: [],
        summary: {
          totalBlocks: 0,
          totalChars: 0,
          maxChars,
        },
        error: error?.message || 'Failed to list memory blocks.'
      };
    }
  }
}
