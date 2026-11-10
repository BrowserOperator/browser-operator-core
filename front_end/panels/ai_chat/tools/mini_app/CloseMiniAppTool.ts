// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../../core/Logger.js';
import { MiniAppRegistry } from '../../mini_apps/MiniAppRegistry.js';
import type { Tool, LLMContext, ErrorResult } from '../Tools.js';

const logger = createLogger('CloseMiniAppTool');

/**
 * Arguments for closing a mini app
 */
export interface CloseMiniAppArgs {
  appId: string;
}

/**
 * Result of closing a mini app
 */
export interface CloseMiniAppResult {
  success: boolean;
  appId: string;
  message: string;
}

/**
 * Tool for closing a running mini app
 *
 * Cleans up the mini app, removes its UI, and releases resources.
 * The app can be launched again with launch_mini_app.
 */
export class CloseMiniAppTool implements Tool<CloseMiniAppArgs, CloseMiniAppResult | ErrorResult> {
  name = 'close_mini_app';
  description = 'Closes a running mini app. Removes the UI and cleans up resources. The app can be relaunched later with launch_mini_app. Any unsaved state will be lost unless the app persists it.';

  async execute(args: CloseMiniAppArgs, _ctx?: LLMContext): Promise<CloseMiniAppResult | ErrorResult> {
    const { appId } = args;

    if (!appId) {
      return { error: 'appId is required' };
    }

    logger.info('Closing mini app', { appId });

    try {
      // Check if app is running
      if (!MiniAppRegistry.isRunning(appId)) {
        return {
          success: true,
          appId,
          message: `Mini app "${appId}" was not running`,
        };
      }

      // Close the app
      await MiniAppRegistry.close(appId);

      logger.info('Closed mini app', { appId });

      return {
        success: true,
        appId,
        message: `Mini app "${appId}" closed successfully`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to close mini app:', errorMsg);
      return { error: `Failed to close mini app: ${errorMsg}` };
    }
  }

  schema = {
    type: 'object',
    properties: {
      appId: {
        type: 'string',
        description: 'The unique identifier of the mini app to close',
      },
    },
    required: ['appId'],
  };
}
