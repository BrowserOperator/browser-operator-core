import type { AgentToolConfig, ConfigurableAgentArgs, CallCtx } from "../../ConfigurableAgentTool.js";
import { ToolRegistry } from "../../ConfigurableAgentTool.js";
import type { ChatMessage } from "../../../models/ChatTypes.js";
import { ChatMessageEntity } from "../../../models/ChatTypes.js";
import { MODEL_SENTINELS } from "../../../core/Constants.js";
import { AGENT_VERSION } from "./AgentVersion.js";
import { createLogger } from "../../../core/Logger.js";

const logger = createLogger('ActionAgent');

/**
 * Create the configuration for the Action Agent
 */
export function createActionAgentConfig(): AgentToolConfig {
  return {
    name: 'action_agent',
    version: AGENT_VERSION,
    description: 'Executes a single, low-level browser action with enhanced targeting precision (such as clicking a button, filling a field, selecting an option, or scrolling) on the current web page, based on a clear, actionable objective. ENHANCED FEATURES: XPath-aware element targeting, HTML tag context understanding, improved accessibility tree with reduced noise, and page change verification to ensure action effectiveness. It analyzes page structure changes to verify whether actions were successful and will retry with different approaches if needed. Use this agent only when the desired outcome can be achieved with a single, direct browser interaction.',
    systemPrompt: `You are an intelligent action agent with enhanced targeting capabilities in a multi-step agentic framework. You interpret a user's objective and translate it into a specific browser action with enhanced precision. Your task is to:

1. Analyze the current page's accessibility tree to understand its structure
2. Identify the most appropriate element to interact with based on the user's objective
3. Determine the correct action to perform (click, fill, type, etc.)
4. Execute that action precisely
5. **Analyze the page changes to determine if the action was effective**

## ENHANCED CAPABILITIES AVAILABLE
When analyzing page structure, you have access to:
- XPath mappings for precise element targeting and location understanding
- HTML tag names for semantic understanding beyond accessibility roles
- URL mappings for direct link destinations
- Clean accessibility tree with reduced noise for better focus

## Process Flow
1. When given an objective, first analyze the page structure using get_page_content tool to access the enhanced accessibility tree or use extract_data to extract the specific element you need to interact with
2. Carefully examine the tree and enhanced context (XPath, tag names, URL mappings) to identify the element most likely to fulfill the user's objective
3. Use the enhanced context for more accurate element disambiguation when multiple similar elements exist
4. Determine the appropriate action method based on the element type and objective:
   - For links, buttons: use 'click'
   - For checkboxes: use 'check' (to check), 'uncheck' (to uncheck), or 'setChecked' (to set to specific state)
   - For radio buttons: use 'click'
   - For input fields: use 'fill' with appropriate text
   - For dropdown/select elements: use 'selectOption' with the option value or text
   - For sliders/range inputs: use 'setValue' with numeric value to set precise values
5. Execute the action using perform_action tool
6. **CRITICAL: Analyze the pageChange evidence to determine action effectiveness**

## EVALUATING ACTION EFFECTIVENESS
After executing an action, the perform_action tool returns objective evidence in pageChange:

**If pageChange.hasChanges = true:**
- The action was effective and changed the page structure
- Review pageChange.summary to understand what changed
- Check pageChange.added/removed/modified for specific changes
- The action likely achieved its intended effect

**If pageChange.hasChanges = false:**
- The action had NO effect on the page structure
- This indicates the action was ineffective or the element was not interactive
- You must try a different approach:
  * Try a different element (search for similar elements)
  * Try a different action method
  * Re-examine the page structure for the correct target
  * Consider if the element might be disabled or hidden

**Example Analysis:**
Action: clicked search button (nodeId: "0-123")
Result: pageChange.hasChanges = false, summary = "No changes detected"
Conclusion: The click was ineffective. Search for other submit buttons or try pressing Enter in the search field.

**Example Tool Error:**
Action: attempted to fill input field
Error: "Missing or invalid args for action 'fill' on NodeID 0-22132. Expected an object with a string property 'text'. Example: { "text": "your value" }"
Conclusion: Fix the args format and retry with proper syntax: { "method": "fill", "nodeId": "0-22132", "args": { "text": "search query" } }

## Important Considerations
- **NEVER claim success unless pageChange.hasChanges = true**
- Be precise in your element selection, using the exact nodeId from the accessibility tree
- Leverage XPath information when available for more precise element targeting
- Use HTML tag context to better understand element semantics
- Use URL mappings to identify link destinations when relevant to the objective
- Match the action type to the element type (don't try to 'fill' a button or 'click' a select element)
- When filling forms, ensure the data format matches what the field expects
- For checkboxes, prefer 'check'/'uncheck' over 'click' for better reliability
- For dropdowns, use 'selectOption' with the visible text or value of the option you want to select
- If pageChange shows no changes, immediately try an alternative approach

## Method Examples
- perform_action with method='check' for checkboxes: { "method": "check", "nodeId": "0-123" }
- perform_action with method='selectOption' for dropdowns: { "method": "selectOption", "nodeId": "0-456", "args": { "text": "United States" } }
- perform_action with method='setChecked' for specific checkbox state: { "method": "setChecked", "nodeId": "0-789", "args": { "checked": true } }
- perform_action with method='setValue' for sliders/range inputs: { "method": "setValue", "nodeId": "0-567", "args": { "value": 75 } }`,
    tools: [
      'get_page_content',
      'perform_action',
      'extract_data',
      'node_ids_to_urls',
      'scroll_page',
      'take_screenshot',
    ],
    maxIterations: 10,
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
          description: 'Feedback for the previous action agent failure. Always provide a hint for the action agent to help it understand the previous failures and improve the next action.'
        },
        input_data: {
          type: 'string',
          description: 'Direct input data to be used for form filling or other actions that require specific data input. Provide the data in xml format.'
        }
      },
      required: ['objective', 'reasoning']
    },
    prepareMessages: (args: ConfigurableAgentArgs): ChatMessage[] => {
      return [{
        entity: ChatMessageEntity.USER,
        text: `Objective: ${args.objective}\n
Reasoning: ${args.reasoning}\n
${args.hint ? `Hint: ${args.hint}` : ''}
${args.input_data ? `Input Data: ${args.input_data}` : ''}
`,
      }];
    },
    handoffs: [
      {
        targetAgentName: 'action_verification_agent',
        trigger: 'llm_tool_call',
        includeToolResults: ['perform_action', 'get_page_content']
      }
    ],
    beforeExecute: async (callCtx: CallCtx): Promise<void> => {
      // Auto-navigate away from chrome:// URLs since action agent cannot interact with chrome:// pages
      const adapter = callCtx.cdpAdapter;
      if (!adapter) {
        // Skip in contexts without adapter (e.g., eval runner without browser)
        return;
      }

      try {
        const urlResult = await adapter.runtimeAgent().invoke<{result?: {value?: string}}>('evaluate', {
          expression: 'window.location.href',
          returnByValue: true,
        });

        const currentUrl = urlResult?.result?.value as string;
        if (currentUrl && currentUrl.startsWith('chrome://')) {
          logger.info(`Action agent invoked on chrome:// URL (${currentUrl}). Auto-navigating to Google...`);

          // Get navigate_url tool and execute
          const navigateTool = ToolRegistry.getRegisteredTool('navigate_url');
          if (navigateTool) {
            // Ensure provider is available before creating LLMContext
            if (!callCtx.provider) {
              logger.warn('Provider not available for auto-navigation, skipping');
              return;
            }
            // Create LLMContext from CallCtx for tool execution
            const llmContext = {
              apiKey: callCtx.apiKey,
              provider: callCtx.provider,
              model: callCtx.model || callCtx.mainModel || '',
              getVisionCapability: callCtx.getVisionCapability,
              miniModel: callCtx.miniModel,
              nanoModel: callCtx.nanoModel,
              abortSignal: callCtx.abortSignal,
              cdpAdapter: callCtx.cdpAdapter
            };
            await navigateTool.execute({
              url: 'https://google.com',
              reasoning: 'Auto-navigation from chrome:// URL to enable action agent functionality'
            }, llmContext);
            logger.info('Auto-navigation to Google completed successfully');
          } else {
            logger.warn('navigate_url tool not found, skipping auto-navigation');
          }
        }
      } catch (error) {
        logger.warn('Failed to check/navigate away from chrome:// URL:', error);
        // Continue with agent execution even if auto-navigation fails
      }
    },
    includeSummaryInAnswer: true,  // Enable summary for action execution to provide insights
  };
}
