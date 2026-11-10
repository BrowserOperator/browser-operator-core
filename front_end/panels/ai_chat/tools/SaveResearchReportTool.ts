// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../core/Logger.js';
import type { Tool, LLMContext } from './Tools.js';
import { FileStorageManager } from './FileStorageManager.js';
import { FileContentViewer } from '../ui/FileContentViewer.js';

const logger = createLogger('Tool:SaveResearchReport');

export interface SaveResearchReportArgs {
  reasoning: string;
  report: string;
  filename: string;
}

export interface SaveResearchReportResult {
  success: boolean;
  reasoning?: string;
  fileName?: string;
  message?: string;
  error?: string;
}

/**
 * SaveResearchReportTool - Saves a research report to file storage and displays it
 *
 * This tool is used by the Deep Research agent to save and display the final
 * research report. It:
 * 1. Saves the markdown report to FileStorageManager
 * 2. Automatically opens the report in FileContentViewer
 * 3. Returns the reasoning text to be displayed in chat
 */
export class SaveResearchReportTool implements Tool<SaveResearchReportArgs, SaveResearchReportResult> {
  name = 'save_research_report';
  description = 'Save the final research report and display it in the viewer. Use this when your research is complete to present findings to the user.';

  schema = {
    type: 'object',
    properties: {
      reasoning: {
        type: 'string',
        description: '2-3 sentences explaining your research approach, key insights, and how you organized the findings'
      },
      report: {
        type: 'string',
        description: 'The full markdown research report (aim for 5000+ words for comprehensive topics). Include executive summary, detailed findings, source citations, and conclusions.'
      },
      filename: {
        type: 'string',
        description: 'Descriptive filename for the report (e.g., "ai_market_trends_research_report.md"). Must end with .md'
      }
    },
    required: ['reasoning', 'report', 'filename']
  };

  async execute(args: SaveResearchReportArgs, _ctx?: LLMContext): Promise<SaveResearchReportResult> {
    logger.info('Executing save research report', { filename: args.filename });

    // Validate filename ends with .md
    let filename = args.filename;
    if (!filename.toLowerCase().endsWith('.md')) {
      filename = `${filename}.md`;
    }

    const manager = FileStorageManager.getInstance();

    try {
      // Check if file already exists and update or create accordingly
      const existingFile = await manager.readFile(filename);

      if (existingFile) {
        // Update existing file
        await manager.updateFile(filename, args.report);
        logger.info('Updated existing research report', { filename });
      } else {
        // Create new file
        await manager.createFile(filename, args.report, 'text/markdown');
        logger.info('Created new research report', { filename });
      }

      // Get the file info for the viewer
      const files = await manager.listFiles();
      const file = files.find(f => f.fileName === filename);

      if (file) {
        // Auto-open in FileContentViewer
        try {
          await FileContentViewer.show(file, args.report);
          logger.info('Research report opened in viewer', { filename });
        } catch (viewerError) {
          logger.warn('Failed to auto-open viewer, file still saved', { filename, error: viewerError });
        }
      }

      // Return reasoning to display in chat
      return {
        success: true,
        reasoning: args.reasoning,
        fileName: filename,
        message: `Research report saved as "${filename}" and opened in viewer.`
      };
    } catch (error: any) {
      logger.error('Failed to save research report', { filename, error: error?.message });
      return {
        success: false,
        error: error?.message || 'Failed to save research report.'
      };
    }
  }
}
