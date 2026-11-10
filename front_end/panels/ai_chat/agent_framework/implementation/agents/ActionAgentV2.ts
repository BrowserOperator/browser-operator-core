// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { AgentToolConfig, ConfigurableAgentArgs, CallCtx } from '../../ConfigurableAgentTool.js';
import { ToolRegistry } from '../../ConfigurableAgentTool.js';
import type { ChatMessage } from '../../../models/ChatTypes.js';
import { ChatMessageEntity } from '../../../models/ChatTypes.js';
import { MODEL_SENTINELS } from '../../../core/Constants.js';
import { AGENT_VERSION } from './AgentVersion.js';
import { createLogger } from '../../../core/Logger.js';
import { ActionPatternCache } from '../../../tools/action_cache/ActionPatternCache.js';
import { getActionPatternCapture } from '../../../tools/action_cache/ActionPatternCapture.js';
import type { PerformActionWithIntent } from '../../../tools/action_cache/types.js';

const logger = createLogger('ActionAgentV2');

/**
 * ActionAgentV2 Input Schema with semantic_intent for caching
 */
interface ActionAgentV2Args extends ConfigurableAgentArgs {
  objective: string;
  reasoning: string;
  hint?: string;
  input_data?: string;
  /** Optional semantic intent for cache lookup (e.g., "search-input", "add-to-cart") */
  semantic_intent?: string;
}

/**
 * Tracks the last perform_action call with semantic_intent for caching
 */
interface LastActionInfo {
  nodeId: string;
  method: string;
  semanticIntent: string;
  success: boolean;
}

// Store last action info per session for caching
const lastActionMap = new Map<string, LastActionInfo>();

/**
 * Create the configuration for ActionAgentV2
 *
 * ActionAgentV2 adds XPath caching to ActionAgent:
 * - First call (cache miss): LLM selects element + generates semantic_intent → cache XPath
 * - Subsequent calls (cache hit): Use cached XPath directly (no LLM)
 */
export function createActionAgentV2Config(): AgentToolConfig {
  return {
    name: 'action_agent_v2',
    version: AGENT_VERSION,
    description: 'ActionAgent with XPath caching. On first use, LLM selects element and generates semantic_intent. On subsequent calls with same intent, uses cached XPath without LLM. Provide semantic_intent in input for cache lookup.',
    systemPrompt: `You are an intelligent action agent with XPath caching for fast repeated actions.

## MANDATORY FIRST STEP - TRY CACHE
**YOUR VERY FIRST TOOL CALL MUST BE try_cached_action.** This is required, not optional.

Before ANYTHING else, infer the semantic intent from the objective and try the cache:

| Objective contains | semantic_intent | method |
|-------------------|-----------------|--------|
| search, query, find | "search-input" | "fill" |
| login, sign in | "login-submit" | "click" |
| add to cart, buy | "add-to-cart" | "click" |
| checkout, pay | "checkout-button" | "click" |
| accept, cookies, consent | "accept-cookies" | "click" |
| submit, send | "submit-button" | "click" |
| checkbox, check, select option | "checkbox-[name]" | "check" |
| dropdown, select | "dropdown-[name]" | "selectOption" |

**ALWAYS call try_cached_action FIRST:**
\`\`\`
try_cached_action({
  semantic_intent: "search-input",  // infer from objective
  method: "fill",                    // match the action type
  args: { text: "query" }           // if fill/selectOption
})
\`\`\`

**Then follow this decision tree:**
- If cached=true AND success=true → DONE. Provide final answer immediately.
- If cached=true AND success=false → Cache failed. Use get_page_content_v1 to find correct element.
- If cached=false → No cache. Use get_page_content_v1 to find element.

## CRITICAL: semantic_intent Field
**ALWAYS include semantic_intent when calling perform_action.** This populates the cache for next time.

The semantic_intent should describe the PURPOSE of this element in a reusable way:
- "search-input" for search boxes
- "login-submit" for login/sign-in buttons
- "add-to-cart" for add to cart buttons
- "quantity-input" for quantity fields
- "checkout-button" for checkout buttons
- "filter-dropdown" for filter/sort selectors
- "next-page" for pagination next buttons
- "accept-cookies" for cookie consent buttons

Format your perform_action calls like this:
{
  "method": "click",
  "nodeId": "0-123",
  "reasoning": "Clicking the add to cart button",
  "semantic_intent": "add-to-cart"
}

## Your Task
1. Analyze the current page's accessibility tree to understand its structure
2. Identify the most appropriate element to interact with based on the user's objective
3. Determine the correct action to perform (click, fill, type, etc.)
4. Execute that action precisely with semantic_intent
5. Analyze the page changes to determine if the action was effective

## ENHANCED CAPABILITIES AVAILABLE
When analyzing page structure, you have access to:
- XPath mappings for precise element targeting and location understanding
- HTML tag names for semantic understanding beyond accessibility roles
- URL mappings for direct link destinations
- Clean accessibility tree with reduced noise for better focus

## Process Flow
1. When given an objective, first analyze the page structure using get_page_content_v1 tool
2. Carefully examine the tree and enhanced context (XPath, tag names, URL mappings)
3. Use the enhanced context for more accurate element disambiguation
4. Determine the appropriate action method based on the element type and objective:
   - For links, buttons: use 'click'
   - For context menus: use 'rightClick'
   - For checkboxes: use 'check', 'uncheck', or 'setChecked'
   - For radio buttons: use 'click'
   - For input fields: use 'fill' with appropriate text
   - For dropdown/select elements: use 'selectOption'
5. Execute the action using perform_action with semantic_intent
6. Analyze the pageChange evidence to determine action effectiveness

## EVALUATING ACTION EFFECTIVENESS
After executing an action, the perform_action tool returns pageChange evidence:

**If pageChange.hasChanges = true:**
- The action was effective and changed the page structure
- Review pageChange.summary to understand what changed
- The action likely achieved its intended effect

**If pageChange.hasChanges = false:**
- The action had NO effect on the page structure
- Try a different approach:
  * Try a different element
  * Try a different action method
  * Re-examine the page structure

## Important Considerations
- **NEVER claim success unless pageChange.hasChanges = true**
- **ALWAYS include semantic_intent in perform_action calls**
- Be precise in element selection using exact nodeId from accessibility tree
- Match action type to element type

## Method Examples
**IMPORTANT: Always use EncodedId format (e.g., "0-123") and include semantic_intent**
- Click button: { "method": "click", "nodeId": "0-123", "semantic_intent": "add-to-cart" }
- Fill input: { "method": "fill", "nodeId": "0-456", "args": { "text": "search query" }, "semantic_intent": "search-input" }
- Select option: { "method": "selectOption", "nodeId": "0-789", "args": { "text": "United States" }, "semantic_intent": "country-dropdown" }

## Accessibility Tree - Efficient Usage
By default, get_page_content_v1 returns viewport-only content.

### Search-first pattern (recommended for large pages):
1. Search: get_page_content_v1({ searchQuery: "search input" }) → returns matching element IDs
2. Focus: get_page_content_v1({ focusElementId: "0-456" }) → returns element's subtree
3. Act: perform_action({ nodeId: "0-456", method: "fill", args: { text: "query" }, semantic_intent: "search-input" })`,
    tools: [
      'try_cached_action',  // Check cache first - fastest path
      'get_page_content_v1',
      'perform_action',
      'extract_data',
      'node_ids_to_urls',
      'scroll_page',
      'take_screenshot',
    ],
    maxIterations: 12,
    modelName: MODEL_SENTINELS.USE_MINI,
    temperature: 0.5,
    schema: {
      type: 'object',
      properties: {
        objective: {
          type: 'string',
          description: 'The natural language description of the desired action (e.g., "click the login button", "fill the search box with \'query\'").'
        },
        reasoning: {
          type: 'string',
          description: 'Reasoning for invoking this specialized action agent.'
        },
        hint: {
          type: 'string',
          description: 'Feedback for the previous action agent failure.'
        },
        input_data: {
          type: 'string',
          description: 'Direct input data for form filling.'
        },
        semantic_intent: {
          type: 'string',
          description: 'Optional semantic intent for cache lookup (e.g., "search-input", "add-to-cart"). If provided and cached, action executes without LLM.'
        }
      },
      required: ['objective', 'reasoning']
    },
    prepareMessages: (args: ConfigurableAgentArgs): ChatMessage[] => {
      const v2Args = args as ActionAgentV2Args;
      return [{
        entity: ChatMessageEntity.USER,
        text: `Objective: ${v2Args.objective}
Reasoning: ${v2Args.reasoning}
${v2Args.hint ? `Hint: ${v2Args.hint}` : ''}
${v2Args.input_data ? `Input Data: ${v2Args.input_data}` : ''}
${v2Args.semantic_intent ? `Expected Intent: ${v2Args.semantic_intent} (use this as semantic_intent in perform_action)` : ''}
`,
      }];
    },
    handoffs: [
      {
        targetAgentName: 'action_verification_agent',
        trigger: 'llm_tool_call',
        includeToolResults: ['perform_action', 'get_page_content_v1']
      }
    ],
    beforeExecute: async (callCtx: CallCtx): Promise<void> => {
      const adapter = callCtx.cdpAdapter;
      if (!adapter) {
        return;
      }

      // Check if semantic_intent is provided and we have a cache hit
      const args = (callCtx as any).args as ActionAgentV2Args | undefined;
      if (args?.semantic_intent) {
        try {
          const url = await getCurrentUrl(adapter);
          if (!url) {
            logger.debug('Could not get current URL for cache lookup');
            return;
          }

          const capture = getActionPatternCapture(adapter);
          const lookupResult = await capture.lookupFromCache(url, args.semantic_intent);

          if (lookupResult.found && lookupResult.encodedId && lookupResult.xpathSuccess) {
            // Cache hit! Store info for potential direct execution
            logger.info(`Cache HIT for ${args.semantic_intent} at ${url}`);
            (callCtx as any).cacheHit = {
              encodedId: lookupResult.encodedId,
              pattern: lookupResult.pattern,
              semanticIntent: args.semantic_intent,
            };
          } else if (lookupResult.found && !lookupResult.xpathSuccess) {
            logger.info(`Cache found but XPath failed: ${lookupResult.error}`);
          } else {
            logger.debug(`Cache MISS for ${args.semantic_intent}`);
          }
        } catch (error) {
          logger.warn('Cache lookup error:', error);
        }
      }

      // Auto-navigate away from chrome:// URLs
      try {
        const urlResult = await adapter.runtimeAgent().invoke<{result?: {value?: string}}>('evaluate', {
          expression: 'window.location.href',
          returnByValue: true,
        });

        const currentUrl = urlResult?.result?.value as string;
        if (currentUrl && currentUrl.startsWith('chrome://')) {
          logger.info(`ActionAgentV2 invoked on chrome:// URL (${currentUrl}). Auto-navigating to Google...`);

          const navigateTool = ToolRegistry.getRegisteredTool('navigate_url');
          if (navigateTool) {
            const llmContext = {
              apiKey: callCtx.apiKey,
              provider: callCtx.provider!,
              model: callCtx.model || callCtx.mainModel || '',
              getVisionCapability: callCtx.getVisionCapability,
              miniModel: callCtx.miniModel,
              nanoModel: callCtx.nanoModel,
              abortSignal: callCtx.abortSignal,
              cdpAdapter: callCtx.cdpAdapter
            };
            await navigateTool.execute({
              url: 'https://google.com',
              reasoning: 'Auto-navigation from chrome:// URL'
            }, llmContext);
          }
        }
      } catch (error) {
        logger.warn('Failed to check/navigate away from chrome:// URL:', error);
      }
    },
    afterExecute: async (result: any, agentSession: any, callCtx: CallCtx): Promise<void> => {
      const adapter = callCtx.cdpAdapter;
      if (!adapter) {
        return;
      }

      // Parse agent session messages to find perform_action calls with semantic_intent
      const messages = agentSession?.messages || [];
      if (messages.length === 0) {
        return;
      }

      // Build a map of tool call IDs to their results
      const toolResultMap = new Map<string, { result?: any; error?: string }>();
      for (const message of messages) {
        if (message.type === 'tool_result') {
          const content = message.content as any;
          toolResultMap.set(content.toolCallId, {
            result: content.result,
            error: content.error,
          });
        }
      }

      // Find the last successful perform_action call with semantic_intent
      let lastAction: { nodeId: string; semanticIntent: string } | null = null;

      for (const message of messages) {
        if (message.type === 'tool_call') {
          const content = message.content as any;
          if (content.toolName === 'perform_action') {
            const toolArgs = content.toolArgs || {};
            const toolResult = toolResultMap.get(content.toolCallId);

            // Check if this call has semantic_intent and succeeded
            if (toolArgs.semantic_intent && toolArgs.nodeId && toolResult && !toolResult.error) {
              lastAction = {
                nodeId: toolArgs.nodeId,
                semanticIntent: toolArgs.semantic_intent,
              };
              logger.debug(`Found perform_action with semantic_intent: ${toolArgs.semantic_intent}`);
            }
          }
        }
      }

      if (!lastAction) {
        logger.debug('No successful perform_action with semantic_intent found');
        return;
      }

      try {
        const url = await getCurrentUrl(adapter);
        if (!url) {
          return;
        }

        const capture = getActionPatternCapture(adapter);
        const saved = await capture.capturePattern(
          lastAction.nodeId,
          url,
          lastAction.semanticIntent
        );

        if (saved) {
          logger.info(`Captured XPath for ${lastAction.semanticIntent} at ${url}`);
        }
      } catch (error) {
        logger.warn('Failed to capture action pattern:', error);
      }
    },
    includeSummaryInAnswer: true,
  };
}

/**
 * Helper to get current URL from adapter
 */
async function getCurrentUrl(adapter: any): Promise<string | null> {
  try {
    const result = await adapter.runtimeAgent().invoke('evaluate', {
      expression: 'window.location.href',
      returnByValue: true,
    }) as {result?: {value?: string}};
    return result?.result?.value || null;
  } catch {
    return null;
  }
}

/**
 * Hook to intercept perform_action calls and extract semantic_intent
 * This should be called from a custom wrapper or tool interceptor
 */
export function recordPerformAction(
  sessionId: string,
  args: PerformActionWithIntent,
  success: boolean
): void {
  if (args.semantic_intent) {
    lastActionMap.set(sessionId, {
      nodeId: args.nodeId,
      method: args.method,
      semanticIntent: args.semantic_intent,
      success,
    });
    logger.debug(`Recorded perform_action: ${args.method} on ${args.nodeId} with intent ${args.semantic_intent}`);
  }
}

/**
 * Check if we have a cache hit and can execute directly
 */
export async function tryExecuteFromCache(
  adapter: any,
  semanticIntent: string,
  method: string,
  actionArgs?: Record<string, unknown>
): Promise<{ success: boolean; encodedId?: string; error?: string } | null> {
  try {
    const url = await getCurrentUrl(adapter);
    if (!url) {
      return null;
    }

    const cache = ActionPatternCache.getInstance();
    const cacheKey = cache.generateCacheKey(url, semanticIntent);
    const pattern = await cache.get(cacheKey);

    if (!pattern) {
      return null; // Cache miss
    }

    const capture = getActionPatternCapture(adapter);
    const lookup = await capture.lookupFromCache(url, semanticIntent);

    if (!lookup.found || !lookup.encodedId) {
      return null;
    }

    if (!lookup.xpathSuccess) {
      await cache.recordFailure(cacheKey);
      return { success: false, error: 'Cached XPath failed to find element' };
    }

    // Execute action using cached EncodedId
    const performActionTool = ToolRegistry.getRegisteredTool('perform_action');
    if (!performActionTool) {
      return { success: false, error: 'perform_action tool not found' };
    }

    const result = await performActionTool.execute({
      method,
      nodeId: lookup.encodedId,
      reasoning: `Using cached pattern for ${semanticIntent}`,
      args: actionArgs,
    }, { cdpAdapter: adapter } as any);

    const isSuccess = !(result as any).error;

    if (isSuccess) {
      await cache.recordSuccess(cacheKey);
    } else {
      await cache.recordFailure(cacheKey);
    }

    return {
      success: isSuccess,
      encodedId: lookup.encodedId,
      error: (result as any).error,
    };
  } catch (error) {
    logger.error('Cache execution error:', error);
    return { success: false, error: String(error) };
  }
}
