// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../../core/Logger.js';
import { MiniAppRegistry } from '../../mini_apps/MiniAppRegistry.js';
import type { Tool, LLMContext, ErrorResult } from '../Tools.js';

const logger = createLogger('LaunchMiniAppTool');

/**
 * Arguments for launching a mini app
 */
export interface LaunchMiniAppArgs {
  appId: string;
  initialState?: Record<string, unknown>;
}

/**
 * Result of launching a mini app
 */
export interface LaunchMiniAppResult {
  success: boolean;
  appId: string;
  name: string;
  message: string;
  wasAlreadyRunning: boolean;
}

/**
 * Tool for launching a mini app
 *
 * Renders a mini app as a full-screen iframe and returns success status.
 * If the app is already running, returns the existing instance.
 * Only one instance per app type is allowed.
 */
export class LaunchMiniAppTool implements Tool<LaunchMiniAppArgs, LaunchMiniAppResult | ErrorResult> {
  name = 'launch_mini_app';
  description = 'Launches a mini app by its ID. The app will be rendered as a full-screen interactive UI. Only one instance of each app can run at a time. If the app is already running, returns the existing instance. Use list_mini_apps first to see available apps.';

  async execute(args: LaunchMiniAppArgs, _ctx?: LLMContext): Promise<LaunchMiniAppResult | ErrorResult> {
    const { appId, initialState } = args;

    if (!appId) {
      return { error: 'appId is required' };
    }

    logger.info('Launching mini app', { appId, hasInitialState: !!initialState });

    try {
      // Check if already running
      const wasAlreadyRunning = MiniAppRegistry.isRunning(appId);

      // Launch the app (returns existing if already running)
      const instance = await MiniAppRegistry.launch(appId);

      // Set initial state if provided and app wasn't already running
      if (initialState && !wasAlreadyRunning) {
        await instance.controller.setState(initialState);
      }

      logger.info(`Mini app ${wasAlreadyRunning ? 'was already running' : 'launched'}`, { appId });

      return {
        success: true,
        appId: instance.app.id,
        name: instance.app.name,
        message: wasAlreadyRunning
          ? `Mini app "${instance.app.name}" was already running`
          : `Successfully launched mini app "${instance.app.name}"`,
        wasAlreadyRunning,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to launch mini app:', errorMsg);
      return { error: `Failed to launch mini app: ${errorMsg}` };
    }
  }

  schema = {
    type: 'object',
    properties: {
      appId: {
        type: 'string',
        description: 'The unique identifier of the mini app to launch (e.g., "agent_studio", "data_visualizer")',
      },
      initialState: {
        type: 'object',
        description: 'Optional initial state to set when launching the app. Ignored if app is already running.',
      },
    },
    required: ['appId'],
  };
}
