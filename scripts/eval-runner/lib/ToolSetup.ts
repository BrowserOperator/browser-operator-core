/**
 * Tool Setup for Eval Runner
 *
 * Registers DevTools tools and agents needed for eval tests.
 * This is a lighter version of initializeConfiguredAgents that
 * skips browser-specific initializations.
 */

import { ConfigurableAgentTool, ToolRegistry } from '../../../front_end/panels/ai_chat/agent_framework/ConfigurableAgentTool.ts';
import { createLogger } from '../../../front_end/panels/ai_chat/core/Logger.ts';

const logger = createLogger('ToolSetup');

// Import tools
import {
  NavigateURLTool,
  PerformActionTool,
  GetAccessibilityTreeTool,
  GetVisibleAccessibilityTreeTool,
  SearchContentTool,
  NavigateBackTool,
  TakeScreenshotTool,
  ScrollPageTool,
  WaitTool,
  ExecuteJavaScriptTool,
  ClickElementTool,
  ObjectiveDrivenActionTool,
  NodeIDsToURLsTool,
  NetworkAnalysisTool,
} from '../../../front_end/panels/ai_chat/tools/Tools.ts';

// Import additional CDP-compatible tools
import { ExecuteCodeTool } from '../../../front_end/panels/ai_chat/tools/ExecuteCodeTool.ts';
import { HybridAccessibilityTreeTool, ResolveEncodedIdTool } from '../../../front_end/panels/ai_chat/tools/HybridAccessibilityTreeTool.ts';
import { SchemaBasedExtractorTool } from '../../../front_end/panels/ai_chat/tools/SchemaBasedExtractorTool.ts';
import { StreamlinedSchemaExtractorTool } from '../../../front_end/panels/ai_chat/tools/StreamlinedSchemaExtractorTool.ts';
import { SearchTool } from '../../../front_end/panels/ai_chat/tools/SearchTool.ts';
import { TryCachedActionTool } from '../../../front_end/panels/ai_chat/tools/TryCachedActionTool.ts';

// Import agent configs
import { createActionAgentConfig } from '../../../front_end/panels/ai_chat/agent_framework/implementation/agents/ActionAgent.ts';
import { createActionAgentV1Config } from '../../../front_end/panels/ai_chat/agent_framework/implementation/agents/ActionAgentV1.ts';
import { createActionAgentV2Config } from '../../../front_end/panels/ai_chat/agent_framework/implementation/agents/ActionAgentV2.ts';
import { createWebTaskAgentConfig } from '../../../front_end/panels/ai_chat/agent_framework/implementation/agents/WebTaskAgent.ts';
import { createResearchAgentConfig } from '../../../front_end/panels/ai_chat/agent_framework/implementation/agents/ResearchAgent.ts';

// Import V0 baseline tools for comparison
import { GetAccessibilityTreeToolV0 } from '../../../front_end/panels/ai_chat/tools/GetAccessibilityTreeToolV0.ts';

// DOM tools registration is lazy-loaded since it requires SDK (browser-only)

/**
 * Setup tools and agents for eval runner context.
 * Only registers tools needed for eval tests, skipping browser-specific features.
 */
export async function setupToolsForEval(): Promise<void> {
  logger.info('Registering tools for eval runner...');

  // Skip DOM tools in Node.js - they require browser SDK
  // DOM tools (hybrid accessibility tree, EncodedId resolver) will be available in browser only

  // Register core tools
  ToolRegistry.registerToolFactory('navigate_url', () => new NavigateURLTool());
  ToolRegistry.registerToolFactory('navigate_back', () => new NavigateBackTool());
  ToolRegistry.registerToolFactory('perform_action', () => new PerformActionTool());
  ToolRegistry.registerToolFactory('get_page_content_v1', () => new GetAccessibilityTreeTool());
  ToolRegistry.registerToolFactory('get_visible_content', () => new GetVisibleAccessibilityTreeTool());
  ToolRegistry.registerToolFactory('search_content', () => new SearchContentTool());
  ToolRegistry.registerToolFactory('take_screenshot', () => new TakeScreenshotTool());
  ToolRegistry.registerToolFactory('scroll_page', () => new ScrollPageTool());
  ToolRegistry.registerToolFactory('wait_for_page_load', () => new WaitTool());
  ToolRegistry.registerToolFactory('execute_javascript', () => new ExecuteJavaScriptTool());
  ToolRegistry.registerToolFactory('click_element', () => new ClickElementTool());

  // Register CDP-compatible tools for testing
  ToolRegistry.registerToolFactory('execute_code', () => new ExecuteCodeTool());
  ToolRegistry.registerToolFactory('get_hybrid_accessibility_tree', () => new HybridAccessibilityTreeTool());
  ToolRegistry.registerToolFactory('resolve_encoded_id', () => new ResolveEncodedIdTool());
  ToolRegistry.registerToolFactory('objective_driven_action', () => new ObjectiveDrivenActionTool());
  ToolRegistry.registerToolFactory('node_ids_to_urls', () => new NodeIDsToURLsTool());
  ToolRegistry.registerToolFactory('analyze_network', () => new NetworkAnalysisTool());

  // Register schema extraction tools
  ToolRegistry.registerToolFactory('extract_data', () => new SchemaBasedExtractorTool());
  ToolRegistry.registerToolFactory('extract_schema_streamlined', () => new StreamlinedSchemaExtractorTool());

  // Register search tool
  ToolRegistry.registerToolFactory('search', () => new SearchTool());

  // Register cache-check tool for ActionAgentV2
  ToolRegistry.registerToolFactory('try_cached_action', () => new TryCachedActionTool());

  // Register V0 baseline tool (now default 'get_page_content')
  ToolRegistry.registerToolFactory('get_page_content', () => new GetAccessibilityTreeToolV0());

  // Register Action Agent (default)
  const actionAgentConfig = createActionAgentConfig();
  const actionAgent = new ConfigurableAgentTool(actionAgentConfig);
  ToolRegistry.registerToolFactory('action_agent', () => actionAgent);

  // Register V1 for comparison testing
  const actionAgentV1Config = createActionAgentV1Config();
  const actionAgentV1 = new ConfigurableAgentTool(actionAgentV1Config);
  ToolRegistry.registerToolFactory('action_agent_v1', () => actionAgentV1);

  // Register Action Agent V2 (with XPath caching for A/B testing)
  const actionAgentV2Config = createActionAgentV2Config();
  const actionAgentV2 = new ConfigurableAgentTool(actionAgentV2Config);
  ToolRegistry.registerToolFactory('action_agent_v2', () => actionAgentV2);

  // Register Web Task Agent
  const webTaskAgentConfig = createWebTaskAgentConfig();
  const webTaskAgent = new ConfigurableAgentTool(webTaskAgentConfig);
  ToolRegistry.registerToolFactory('web_task_agent', () => webTaskAgent);

  // Register Research Agent
  const researchAgentConfig = createResearchAgentConfig();
  const researchAgent = new ConfigurableAgentTool(researchAgentConfig);
  ToolRegistry.registerToolFactory('research_agent', () => researchAgent);

  // Verify key agents are available
  const registeredActionAgent = ToolRegistry.getRegisteredTool('action_agent');
  const registeredWebTaskAgent = ToolRegistry.getRegisteredTool('web_task_agent');

  if (!registeredActionAgent || !registeredWebTaskAgent) {
    throw new Error('Failed to initialize required agents');
  }

  logger.info('Tools registered successfully');
  logger.debug(`Available tools: ${ToolRegistry.getRegisteredToolNames().join(', ')}`);
}
