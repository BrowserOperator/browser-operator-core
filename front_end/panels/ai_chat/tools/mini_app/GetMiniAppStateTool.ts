// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../../core/Logger.js';
import { MiniAppRegistry } from '../../mini_apps/MiniAppRegistry.js';
import type { MiniAppState } from '../../mini_apps/types/MiniAppTypes.js';
import type { Tool, LLMContext, ErrorResult } from '../Tools.js';

const logger = createLogger('GetMiniAppStateTool');

/**
 * Arguments for getting mini app state
 */
export interface GetMiniAppStateArgs {
  appId: string;
}

/**
 * Result of getting mini app state
 */
export interface GetMiniAppStateResult {
  appId: string;
  state: MiniAppState;
  stateSchema?: Record<string, unknown>;
}

/**
 * Tool for reading the current state of a running mini app
 *
 * Returns the current state as a key-value object. The state structure
 * depends on the specific mini app implementation.
 */
export class GetMiniAppStateTool implements Tool<GetMiniAppStateArgs, GetMiniAppStateResult | ErrorResult> {
  name = 'get_mini_app_state';
  description = 'Gets the current state of a running mini app. Returns the state as a key-value object. The app must be running (use launch_mini_app first). Use this to read data from the mini app UI.';

  async execute(args: GetMiniAppStateArgs, _ctx?: LLMContext): Promise<GetMiniAppStateResult | ErrorResult> {
    const { appId } = args;

    if (!appId) {
      return { error: 'appId is required' };
    }

    logger.info('Getting mini app state', { appId });

    try {
      // Check if app is running
      const instance = MiniAppRegistry.getRunningInstance(appId);
      if (!instance) {
        return { error: `Mini app "${appId}" is not running. Launch it first with launch_mini_app.` };
      }

      // Get the state
      const state = await instance.controller.getState();

      // Get the state schema for context
      const stateSchema = instance.app.getStateSchema();

      logger.info('Got mini app state', { appId, stateKeys: Object.keys(state) });

      return {
        appId,
        state,
        stateSchema: stateSchema as unknown as Record<string, unknown>,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to get mini app state:', errorMsg);
      return { error: `Failed to get mini app state: ${errorMsg}` };
    }
  }

  schema = {
    type: 'object',
    properties: {
      appId: {
        type: 'string',
        description: 'The unique identifier of the mini app to get state from',
      },
    },
    required: ['appId'],
  };
}
