// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * DOM Tools Registration
 *
 * Registers the enhanced DOM tools (hybrid accessibility tree, etc.)
 * with the ToolRegistry for use by agents.
 */

import {ToolRegistry} from '../agent_framework/ConfigurableAgentTool.js';
import {HybridAccessibilityTreeTool, ResolveEncodedIdTool} from './HybridAccessibilityTreeTool.js';
import {createLogger} from '../core/Logger.js';

const logger = createLogger('DOMToolsRegistration');

let isRegistered = false;

/**
 * Register the enhanced DOM tools with the ToolRegistry.
 * This should be called during application initialization.
 */
export function registerDOMTools(): void {
  if (isRegistered) {
    logger.debug('DOM tools already registered');
    return;
  }

  try {
    // Register hybrid accessibility tree tool
    ToolRegistry.registerToolFactory(
        'get_hybrid_accessibility_tree',
        () => new HybridAccessibilityTreeTool(),
    );

    // Register EncodedId resolver tool
    ToolRegistry.registerToolFactory(
        'resolve_encoded_id',
        () => new ResolveEncodedIdTool(),
    );

    isRegistered = true;
    logger.info('DOM tools registered successfully');
  } catch (error) {
    logger.error('Failed to register DOM tools:', error);
  }
}

/**
 * Check if DOM tools are registered.
 */
export function isDOMToolsRegistered(): boolean {
  return isRegistered;
}

/**
 * Get the list of registered DOM tool names.
 */
export function getDOMToolNames(): string[] {
  return [
    'get_hybrid_accessibility_tree',
    'resolve_encoded_id',
  ];
}
