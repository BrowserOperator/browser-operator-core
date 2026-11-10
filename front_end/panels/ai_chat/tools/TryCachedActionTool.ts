// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { Tool } from './Tools.js';
import { ToolRegistry } from '../agent_framework/ConfigurableAgentTool.js';
import { createLogger } from '../core/Logger.js';
import { getActionPatternCapture } from './action_cache/ActionPatternCapture.js';
import { ActionPatternCache } from './action_cache/ActionPatternCache.js';

const logger = createLogger('TryCachedActionTool');

interface TryCachedActionInput {
  semantic_intent: string;
  method: 'click' | 'fill' | 'selectOption' | 'check' | 'uncheck' | 'rightClick';
  args?: Record<string, unknown>;
  reasoning?: string;
}

interface TryCachedActionResult {
  cached: boolean;
  success?: boolean;
  message: string;
  nodeId?: string;
  error?: string;
}

/**
 * Tool that checks cache and executes action if pattern exists.
 * Returns success with result, or { cached: false } to signal LLM should proceed normally.
 */
export class TryCachedActionTool implements Tool<TryCachedActionInput, TryCachedActionResult> {
  name = 'try_cached_action';
  description = `Check if a cached XPath pattern exists for the given semantic intent.
If cached, executes the action directly and returns success.
If not cached, returns { cached: false } - proceed with normal get_page_content flow.

ALWAYS call this FIRST before get_page_content when you know the semantic intent.
Common intents: "search-input", "login-submit", "add-to-cart", "checkout-button", "accept-cookies"`;

  schema = {
    type: 'object' as const,
    properties: {
      semantic_intent: {
        type: 'string',
        description: 'The semantic intent to look up (e.g., "search-input", "add-to-cart", "login-submit")'
      },
      method: {
        type: 'string',
        enum: ['click', 'fill', 'selectOption', 'check', 'uncheck', 'rightClick'],
        description: 'Action method to perform if cached'
      },
      args: {
        type: 'object',
        description: 'Action args (e.g., { text: "query" } for fill, { value: "option" } for selectOption)'
      },
      reasoning: {
        type: 'string',
        description: 'Why you are attempting this cached action'
      }
    },
    required: ['semantic_intent', 'method']
  };

  async execute(input: TryCachedActionInput, ctx: unknown): Promise<TryCachedActionResult> {
    const context = ctx as { cdpAdapter?: any };
    const adapter = context.cdpAdapter;

    if (!adapter) {
      logger.warn('No CDP adapter available for cache lookup');
      return { cached: false, message: 'No CDP adapter, proceed with get_page_content' };
    }

    try {
      // Get current URL
      const url = await this.getCurrentUrl(adapter);
      if (!url) {
        return { cached: false, message: 'Could not get current URL, proceed with get_page_content' };
      }

      logger.info(`Checking cache for ${input.semantic_intent} at ${url}`);

      // Look up cached pattern
      const capture = getActionPatternCapture(adapter);
      const lookup = await capture.lookupFromCache(url, input.semantic_intent);

      if (!lookup.found) {
        logger.debug(`Cache MISS for ${input.semantic_intent}`);
        return { cached: false, message: `No cached pattern for "${input.semantic_intent}", proceed with get_page_content` };
      }

      if (!lookup.encodedId || !lookup.xpathSuccess) {
        logger.debug(`Cache found but XPath failed: ${lookup.error}`);
        return { cached: false, message: `Cached pattern invalid: ${lookup.error}, proceed with get_page_content` };
      }

      logger.info(`Cache HIT for ${input.semantic_intent}, executing with nodeId ${lookup.encodedId}`);

      // Execute action using cached EncodedId
      const performAction = ToolRegistry.getRegisteredTool('perform_action');
      if (!performAction) {
        return { cached: true, success: false, message: 'perform_action tool not found', error: 'Tool not found' };
      }

      const result = await performAction.execute({
        method: input.method,
        nodeId: lookup.encodedId,
        args: input.args,
        reasoning: input.reasoning || `Using cached pattern for ${input.semantic_intent}`,
        semantic_intent: input.semantic_intent,
      }, ctx as any) as { error?: string; pageChange?: { hasChanges: boolean } };

      // Update cache stats
      const cache = ActionPatternCache.getInstance();
      const cacheKey = cache.generateCacheKey(url, input.semantic_intent);

      if (result.error) {
        await cache.recordFailure(cacheKey);
        logger.warn(`Cached action failed: ${result.error}`);
        return {
          cached: true,
          success: false,
          message: `Cached action failed: ${result.error}`,
          error: result.error,
        };
      }

      await cache.recordSuccess(cacheKey);
      logger.info(`Cached action succeeded for ${input.semantic_intent}`);

      return {
        cached: true,
        success: true,
        message: `Action executed via cache: ${input.semantic_intent}`,
        nodeId: lookup.encodedId,
      };
    } catch (error) {
      logger.error('Cache lookup/execution error:', error);
      return {
        cached: false,
        message: `Cache error: ${error}, proceed with get_page_content`,
      };
    }
  }

  private async getCurrentUrl(adapter: any): Promise<string | null> {
    try {
      const result = await adapter.runtimeAgent().invoke('evaluate', {
        expression: 'window.location.href',
        returnByValue: true,
      }) as { result?: { value?: string } };
      return result?.result?.value || null;
    } catch {
      return null;
    }
  }
}
