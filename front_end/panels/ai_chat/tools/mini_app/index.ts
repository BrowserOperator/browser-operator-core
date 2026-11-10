// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Mini App Tools
 *
 * Tools for AI agents to interact with mini apps.
 *
 * These tools provide a complete interface for:
 * - Discovering available mini apps (list_mini_apps)
 * - Launching mini apps (launch_mini_app)
 * - Reading mini app state (get_mini_app_state)
 * - Updating mini app state (update_mini_app_state)
 * - Executing app-specific actions (execute_mini_app_action)
 * - Closing mini apps (close_mini_app)
 */

export { ListMiniAppsTool } from './ListMiniAppsTool.js';
export type { ListMiniAppsArgs, ListMiniAppsResult, MiniAppInfo } from './ListMiniAppsTool.js';

export { LaunchMiniAppTool } from './LaunchMiniAppTool.js';
export type { LaunchMiniAppArgs, LaunchMiniAppResult } from './LaunchMiniAppTool.js';

export { GetMiniAppStateTool } from './GetMiniAppStateTool.js';
export type { GetMiniAppStateArgs, GetMiniAppStateResult } from './GetMiniAppStateTool.js';

export { UpdateMiniAppStateTool } from './UpdateMiniAppStateTool.js';
export type { UpdateMiniAppStateArgs, UpdateMiniAppStateResult } from './UpdateMiniAppStateTool.js';

export { ExecuteMiniAppActionTool } from './ExecuteMiniAppActionTool.js';
export type { ExecuteMiniAppActionArgs, ExecuteMiniAppActionResult } from './ExecuteMiniAppActionTool.js';

export { CloseMiniAppTool } from './CloseMiniAppTool.js';
export type { CloseMiniAppArgs, CloseMiniAppResult } from './CloseMiniAppTool.js';
