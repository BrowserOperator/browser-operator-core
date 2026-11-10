// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../../core/Logger.js';
import { MiniAppRegistry } from '../../mini_apps/MiniAppRegistry.js';
import type { Tool, LLMContext, ErrorResult } from '../Tools.js';

const logger = createLogger('ListMiniAppsTool');

/**
 * Arguments for listing mini apps
 */
export interface ListMiniAppsArgs {
  includeRunning?: boolean;
}

/**
 * Info about a mini app
 */
export interface MiniAppInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  isRunning: boolean;
  supportedActions: string[];
}

/**
 * Result of listing mini apps
 */
export interface ListMiniAppsResult {
  apps: MiniAppInfo[];
  count: number;
}

/**
 * Tool for listing available mini apps
 *
 * Returns information about all registered mini apps, including their
 * descriptions and supported actions for AI agents to understand
 * what each app can do.
 */
export class ListMiniAppsTool implements Tool<ListMiniAppsArgs, ListMiniAppsResult | ErrorResult> {
  name = 'list_mini_apps';
  description = 'Lists all available mini apps that can be launched. Returns app IDs, names, descriptions, and supported actions. Use this to discover what mini apps are available before launching one.';

  async execute(args: ListMiniAppsArgs, _ctx?: LLMContext): Promise<ListMiniAppsResult | ErrorResult> {
    logger.info('Listing mini apps', { includeRunning: args.includeRunning });

    try {
      const allApps = MiniAppRegistry.getAllApps();

      const apps: MiniAppInfo[] = allApps.map(app => ({
        id: app.id,
        name: app.name,
        description: app.description,
        icon: app.icon,
        isRunning: MiniAppRegistry.isRunning(app.id),
        supportedActions: app.getSupportedActions().map(a => `${a.name}: ${a.description}`),
      }));

      // Filter to only running apps if requested
      const result = args.includeRunning === false
        ? apps.filter(app => !app.isRunning)
        : apps;

      logger.info(`Found ${result.length} mini apps`);

      return {
        apps: result,
        count: result.length,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to list mini apps:', errorMsg);
      return { error: `Failed to list mini apps: ${errorMsg}` };
    }
  }

  schema = {
    type: 'object',
    properties: {
      includeRunning: {
        type: 'boolean',
        description: 'If false, only return apps that are not currently running. Default: true (include all apps).',
      },
    },
    required: [],
  };
}
