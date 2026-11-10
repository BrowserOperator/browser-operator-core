// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../core/Logger.js';
import type { Tool, LLMContext, ErrorResult } from './Tools.js';

// Detect if we're in a Node.js environment (eval runner, tests)
const isNodeEnvironment = typeof window === 'undefined' || typeof document === 'undefined';

// Lazy-loaded browser-only SDK dependency
let SDK: typeof import('../../../core/sdk/sdk.js') | null = null;
let sdkLoaded = false;

async function ensureSDK(): Promise<boolean> {
  if (isNodeEnvironment) return false;
  if (!sdkLoaded) {
    sdkLoaded = true;
    try { SDK = await import('../../../core/sdk/sdk.js'); }
    catch { return false; }
  }
  return SDK !== null;
}

const logger = createLogger('RemoveWebAppTool');

/**
 * Arguments for removing webapp
 */
export interface RemoveWebAppArgs {
  webappId: string;
  reasoning: string;
}

/**
 * Result of webapp removal
 */
export interface RemoveWebAppResult {
  success: boolean;
  removed: string[];
  message: string;
}

/**
 * Tool for removing a rendered webapp iframe from the page
 * Cleans up the iframe element and all associated resources.
 */
export class RemoveWebAppTool implements Tool<RemoveWebAppArgs, RemoveWebAppResult | ErrorResult> {
  name = 'remove_webapp';
  description = 'Removes a previously rendered webapp iframe from the page. Cleans up the full-screen iframe and releases resources. Use this after data collection is complete or when the webapp is no longer needed.';

  async execute(args: RemoveWebAppArgs, _ctx?: LLMContext): Promise<RemoveWebAppResult | ErrorResult> {
    logger.info('Removing webapp', {
      webappId: args.webappId,
      reasoning: args.reasoning
    });

    const { webappId, reasoning } = args;

    // Validate required arguments
    if (!webappId || typeof webappId !== 'string') {
      return { error: 'webappId is required and must be a string' };
    }

    if (!reasoning || typeof reasoning !== 'string') {
      return { error: 'Reasoning is required and must be a string' };
    }

    // Get the primary page target
    if (!(await ensureSDK()) || !SDK) {
      return { error: 'SDK not available (Node.js environment)' };
    }
    const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
    if (!target) {
      logger.error('No primary page target available');
      return { error: 'No page target available' };
    }

    try {
      const runtimeAgent = target.runtimeAgent();

      // Execute removal script in page context
      const result = await runtimeAgent.invoke_evaluate({
        expression: `
          (() => {
            const removed = [];

            // Remove the webapp iframe
            const iframe = document.getElementById(${JSON.stringify(webappId)});
            if (iframe) {
              iframe.remove();
              removed.push('iframe');
            }

            return {
              success: true,
              removed: removed,
              message: removed.length > 0 ?
                'Webapp removed: ' + removed.join(', ') :
                'No webapp elements found to remove'
            };
          })()
        `,
        returnByValue: true,
      });

      // Check for evaluation errors
      if (result.exceptionDetails) {
        const errorMsg = result.exceptionDetails.text || 'Unknown evaluation error';
        logger.error('Webapp removal failed with exception:', errorMsg);
        return { error: `Webapp removal failed: ${errorMsg}` };
      }

      // Extract result
      const removalResult = result.result.value as RemoveWebAppResult;

      if (!removalResult || !removalResult.success) {
        logger.error('Webapp removal script returned unsuccessful result');
        return { error: 'Webapp removal script failed to execute properly' };
      }

      logger.info('Successfully removed webapp', {
        webappId,
        removed: removalResult.removed
      });

      return removalResult;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to remove webapp:', errorMsg);
      return { error: `Failed to remove webapp: ${errorMsg}` };
    }
  }

  schema = {
    type: 'object',
    properties: {
      webappId: {
        type: 'string',
        description: 'The unique webapp ID returned from the render_webapp tool. Used to identify which webapp to remove.',
      },
      reasoning: {
        type: 'string',
        description: 'Required explanation for why this webapp is being removed (e.g., "User completed form submission, cleaning up")',
      },
    },
    required: ['webappId', 'reasoning'],
  };
}
