// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../../core/Logger.js';
import { MiniAppRegistry } from '../../mini_apps/MiniAppRegistry.js';
import type { Tool, LLMContext, ErrorResult } from '../Tools.js';

const logger = createLogger('ExecuteMiniAppActionTool');

/**
 * Arguments for executing a mini app action
 */
export interface ExecuteMiniAppActionArgs {
  appId: string;
  actionName: string;
  args?: Record<string, unknown>;
}

/**
 * Result of executing a mini app action
 */
export interface ExecuteMiniAppActionResult {
  success: boolean;
  appId: string;
  actionName: string;
  result: unknown;
  message: string;
}

/**
 * Tool for executing an action on a running mini app
 *
 * Each mini app exposes a set of supported actions that can be invoked.
 * Use list_mini_apps to see what actions each app supports.
 */
export class ExecuteMiniAppActionTool implements Tool<ExecuteMiniAppActionArgs, ExecuteMiniAppActionResult | ErrorResult> {
  name = 'execute_mini_app_action';
  description = 'Executes a specific action on a running mini app. Each app supports different actions (see list_mini_apps for available actions). This is used for app-specific operations like adding items, submitting forms, or triggering behaviors.';

  async execute(args: ExecuteMiniAppActionArgs, _ctx?: LLMContext): Promise<ExecuteMiniAppActionResult | ErrorResult> {
    const { appId, actionName, args: actionArgs } = args;

    if (!appId) {
      return { error: 'appId is required' };
    }

    if (!actionName) {
      return { error: 'actionName is required' };
    }

    logger.info('Executing mini app action', { appId, actionName, hasArgs: !!actionArgs });

    try {
      // Check if app is running
      const instance = MiniAppRegistry.getRunningInstance(appId);
      if (!instance) {
        return { error: `Mini app "${appId}" is not running. Launch it first with launch_mini_app.` };
      }

      // Validate the action exists
      const supportedActions = instance.app.getSupportedActions();
      const actionDef = supportedActions.find(a => a.name === actionName);
      if (!actionDef) {
        const availableActions = supportedActions.map(a => a.name).join(', ');
        return {
          error: `Action "${actionName}" is not supported by mini app "${appId}". Available actions: ${availableActions || 'none'}`,
        };
      }

      // Execute the action
      const result = await instance.controller.executeAction(actionName, actionArgs || {});

      logger.info('Executed mini app action', { appId, actionName, result });

      return {
        success: true,
        appId,
        actionName,
        result,
        message: `Action "${actionName}" executed successfully`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to execute mini app action:', errorMsg);
      return { error: `Failed to execute action "${actionName}": ${errorMsg}` };
    }
  }

  schema = {
    type: 'object',
    properties: {
      appId: {
        type: 'string',
        description: 'The unique identifier of the mini app to execute the action on',
      },
      actionName: {
        type: 'string',
        description: 'The name of the action to execute (see list_mini_apps for available actions)',
      },
      args: {
        type: 'object',
        description: 'Optional arguments to pass to the action. The required args depend on the specific action.',
      },
    },
    required: ['appId', 'actionName'],
  };
}
