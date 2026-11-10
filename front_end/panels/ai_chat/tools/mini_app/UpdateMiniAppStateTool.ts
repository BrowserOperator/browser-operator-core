// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../../core/Logger.js';
import { MiniAppRegistry } from '../../mini_apps/MiniAppRegistry.js';
import type { MiniAppState } from '../../mini_apps/types/MiniAppTypes.js';
import type { Tool, LLMContext, ErrorResult } from '../Tools.js';

const logger = createLogger('UpdateMiniAppStateTool');

/**
 * Arguments for updating mini app state
 */
export interface UpdateMiniAppStateArgs {
  appId: string;
  updates: Record<string, unknown>;
  replace?: boolean;
}

/**
 * Result of updating mini app state
 */
export interface UpdateMiniAppStateResult {
  success: boolean;
  appId: string;
  message: string;
  newState: MiniAppState;
}

/**
 * Tool for updating the state of a running mini app
 *
 * Can either merge updates into existing state (default) or replace
 * the entire state. The UI will automatically reflect the changes.
 */
export class UpdateMiniAppStateTool implements Tool<UpdateMiniAppStateArgs, UpdateMiniAppStateResult | ErrorResult> {
  name = 'update_mini_app_state';
  description = 'Updates the state of a running mini app. By default, merges updates with existing state. Set replace=true to replace the entire state. The mini app UI will automatically reflect the changes.';

  async execute(args: UpdateMiniAppStateArgs, _ctx?: LLMContext): Promise<UpdateMiniAppStateResult | ErrorResult> {
    const { appId, updates, replace } = args;

    if (!appId) {
      return { error: 'appId is required' };
    }

    if (!updates || typeof updates !== 'object') {
      return { error: 'updates must be an object' };
    }

    logger.info('Updating mini app state', { appId, replace, updateKeys: Object.keys(updates) });

    try {
      // Check if app is running
      const instance = MiniAppRegistry.getRunningInstance(appId);
      if (!instance) {
        return { error: `Mini app "${appId}" is not running. Launch it first with launch_mini_app.` };
      }

      // Update the state
      if (replace) {
        await instance.controller.setState(updates);
      } else {
        await instance.controller.updateState(updates);
      }

      // Get the new state
      const newState = await instance.controller.getState();

      logger.info('Updated mini app state', { appId, newStateKeys: Object.keys(newState) });

      return {
        success: true,
        appId,
        message: replace
          ? 'State replaced successfully'
          : 'State updated successfully',
        newState,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to update mini app state:', errorMsg);
      return { error: `Failed to update mini app state: ${errorMsg}` };
    }
  }

  schema = {
    type: 'object',
    properties: {
      appId: {
        type: 'string',
        description: 'The unique identifier of the mini app to update',
      },
      updates: {
        type: 'object',
        description: 'The state updates to apply. Keys are state property names, values are the new values.',
      },
      replace: {
        type: 'boolean',
        description: 'If true, replace the entire state with updates. If false (default), merge updates with existing state.',
      },
    },
    required: ['appId', 'updates'],
  };
}
