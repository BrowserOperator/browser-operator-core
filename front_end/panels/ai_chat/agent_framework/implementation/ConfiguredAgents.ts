// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { FetcherTool } from '../../tools/FetcherTool.js';
import { FinalizeWithCritiqueTool } from '../../tools/FinalizeWithCritiqueTool.js';
import { SchemaBasedExtractorTool } from '../../tools/SchemaBasedExtractorTool.js';
import { StreamlinedSchemaExtractorTool } from '../../tools/StreamlinedSchemaExtractorTool.js';
import { CachedSchemaExtractorTool } from '../../tools/CachedSchemaExtractorTool.js';
import { BookmarkStoreTool } from '../../tools/BookmarkStoreTool.js';
import { DocumentSearchTool } from '../../tools/DocumentSearchTool.js';
import { SearchMemoryTool, UpdateMemoryTool, ListMemoryBlocksTool, createMemoryAgentConfig } from '../../memory/index.js';
import { NavigateURLTool, PerformActionTool, GetAccessibilityTreeTool, SearchContentTool, NavigateBackTool, NodeIDsToURLsTool, TakeScreenshotTool, ScrollPageTool, WaitTool, RenderWebAppTool, GetWebAppDataTool, RemoveWebAppTool, CreateFileTool, UpdateFileTool, DeleteFileTool, ReadFileTool, ListFilesTool } from '../../tools/Tools.js';
import { GetAccessibilityTreeToolV0 } from '../../tools/GetAccessibilityTreeToolV0.js';
import { UpdateTodoTool } from '../../tools/UpdateTodoTool.js';
import { ExecuteCodeTool } from '../../tools/ExecuteCodeTool.js';
import { HTMLToMarkdownTool } from '../../tools/HTMLToMarkdownTool.js';
import { ReadabilityExtractorTool } from '../../tools/ReadabilityExtractorTool.js';
import { SearchTool } from '../../tools/SearchTool.js';
import { TryCachedActionTool } from '../../tools/TryCachedActionTool.js';
// CachedFormFillTool removed - replaced by ActionAgentV2's XPath caching
import { ConfigurableAgentTool, ToolRegistry } from '../ConfigurableAgentTool.js';
import { ThinkingTool } from '../../tools/ThinkingTool.js';
import { SaveResearchReportTool } from '../../tools/SaveResearchReportTool.js';
import { SearchCustomAgentsTool } from '../../tools/SearchCustomAgentsTool.js';
import { CallCustomAgentTool } from '../../tools/CallCustomAgentTool.js';
import { registerMCPMetaTools } from '../../mcp/MCPMetaTools.js';
import { createDirectURLNavigatorAgentConfig } from './agents/DirectURLNavigatorAgent.js';
import { createResearchAgentConfig } from './agents/ResearchAgent.js';
import { createContentWriterAgentConfig } from './agents/ContentWriterAgent.js';
import { createActionAgentConfig } from './agents/ActionAgent.js';
import { createActionAgentV1Config } from './agents/ActionAgentV1.js';
import { createActionAgentV2Config } from './agents/ActionAgentV2.js';
import { createActionVerificationAgentConfig } from './agents/ActionVerificationAgent.js';
import { createClickActionAgentConfig } from './agents/ClickActionAgent.js';
import { createFormFillActionAgentConfig } from './agents/FormFillActionAgent.js';
import { createKeyboardInputActionAgentConfig } from './agents/KeyboardInputActionAgent.js';
import { createHoverActionAgentConfig } from './agents/HoverActionAgent.js';
import { createScrollActionAgentConfig } from './agents/ScrollActionAgent.js';
import { createWebTaskAgentConfig } from './agents/WebTaskAgent.js';
import { createEcommerceProductInfoAgentConfig } from './agents/EcommerceProductInfoAgent.js';
import { createSearchAgentConfig } from './agents/SearchAgent.js';
import { AgentStudioIntegration } from '../../core/AgentStudioIntegration.js';
import { initializeMiniApps } from '../../mini_apps/MiniAppInitialization.js';
import { registerDOMTools } from '../../tools/DOMToolsRegistration.js';

/**
 * Initialize all configured agents
 */
export async function initializeConfiguredAgents(): Promise<void> {
  // Ensure MCP meta-tools are available regardless of mode; selection logic decides if they are surfaced
  registerMCPMetaTools();

  // Initialize mini app system (registers mini apps and mini app tools)
  initializeMiniApps();

  // Register DOM tools (hybrid accessibility tree, EncodedId resolver)
  registerDOMTools();

  // Register core tools
  ToolRegistry.registerToolFactory('navigate_url', () => new NavigateURLTool());
  ToolRegistry.registerToolFactory('navigate_back', () => new NavigateBackTool());
  ToolRegistry.registerToolFactory('node_ids_to_urls', () => new NodeIDsToURLsTool());
  ToolRegistry.registerToolFactory('fetcher_tool', () => new FetcherTool());
  ToolRegistry.registerToolFactory('extract_data', () => new SchemaBasedExtractorTool());
  ToolRegistry.registerToolFactory('extract_schema_streamlined', () => new StreamlinedSchemaExtractorTool());
  ToolRegistry.registerToolFactory('extract_cached', () => new CachedSchemaExtractorTool());
  ToolRegistry.registerToolFactory('finalize_with_critique', () => new FinalizeWithCritiqueTool());
  ToolRegistry.registerToolFactory('perform_action', () => new PerformActionTool());
  ToolRegistry.registerToolFactory('get_page_content_v1', () => new GetAccessibilityTreeTool());
  ToolRegistry.registerToolFactory('search_content', () => new SearchContentTool());
  ToolRegistry.registerToolFactory('take_screenshot', () => new TakeScreenshotTool());
  ToolRegistry.registerToolFactory('html_to_markdown', () => new HTMLToMarkdownTool());
  ToolRegistry.registerToolFactory('readability_extractor', () => new ReadabilityExtractorTool());
  ToolRegistry.registerToolFactory('search', () => new SearchTool());
  ToolRegistry.registerToolFactory('try_cached_action', () => new TryCachedActionTool());
  // cached_form_fill removed - replaced by ActionAgentV2's XPath caching
  ToolRegistry.registerToolFactory('scroll_page', () => new ScrollPageTool());
  ToolRegistry.registerToolFactory('wait_for_page_load', () => new WaitTool());
  ToolRegistry.registerToolFactory('thinking', () => new ThinkingTool());
  ToolRegistry.registerToolFactory('create_file', () => new CreateFileTool());
  ToolRegistry.registerToolFactory('update_file', () => new UpdateFileTool());
  ToolRegistry.registerToolFactory('delete_file', () => new DeleteFileTool());
  ToolRegistry.registerToolFactory('read_file', () => new ReadFileTool());
  ToolRegistry.registerToolFactory('list_files', () => new ListFilesTool());
  ToolRegistry.registerToolFactory('update_todo', () => new UpdateTodoTool());
  ToolRegistry.registerToolFactory('execute_code', () => new ExecuteCodeTool());

  // Register webapp rendering tools
  ToolRegistry.registerToolFactory('render_webapp', () => new RenderWebAppTool());
  ToolRegistry.registerToolFactory('get_webapp_data', () => new GetWebAppDataTool());
  ToolRegistry.registerToolFactory('remove_webapp', () => new RemoveWebAppTool());

  // Register bookmark and document search tools
  ToolRegistry.registerToolFactory('bookmark_store', () => new BookmarkStoreTool());
  ToolRegistry.registerToolFactory('document_search', () => new DocumentSearchTool());

  // Register research report tool
  ToolRegistry.registerToolFactory('save_research_report', () => new SaveResearchReportTool());

  // Register custom agent tools (for calling agents created in Agent Studio)
  ToolRegistry.registerToolFactory('search_custom_agents', () => new SearchCustomAgentsTool());
  ToolRegistry.registerToolFactory('call_custom_agent', () => new CallCustomAgentTool());

  // Register memory tools
  ToolRegistry.registerToolFactory('search_memory', () => new SearchMemoryTool());
  ToolRegistry.registerToolFactory('update_memory', () => new UpdateMemoryTool());
  ToolRegistry.registerToolFactory('list_memory_blocks', () => new ListMemoryBlocksTool());

  // Create and register Direct URL Navigator Agent
  const directURLNavigatorAgentConfig = createDirectURLNavigatorAgentConfig();
  const directURLNavigatorAgent = new ConfigurableAgentTool(directURLNavigatorAgentConfig);
  ToolRegistry.registerToolFactory('direct_url_navigator_agent', () => directURLNavigatorAgent);

  // Create and register Research Agent
  const researchAgentConfig = createResearchAgentConfig();
  const researchAgent = new ConfigurableAgentTool(researchAgentConfig);
  ToolRegistry.registerToolFactory('research_agent', () => researchAgent);

  // Create and register Search Agent
  const searchAgentConfig = createSearchAgentConfig();
  const searchAgent = new ConfigurableAgentTool(searchAgentConfig);
  ToolRegistry.registerToolFactory('search_agent', () => searchAgent);

  // Create and register Content Writer Agent
  const contentWriterAgentConfig = createContentWriterAgentConfig();
  const contentWriterAgent = new ConfigurableAgentTool(contentWriterAgentConfig);
  ToolRegistry.registerToolFactory('content_writer_agent', () => contentWriterAgent);

  ToolRegistry.registerToolFactory('get_page_content', () => new GetAccessibilityTreeToolV0());

  const actionAgentConfig = createActionAgentConfig();
  const actionAgent = new ConfigurableAgentTool(actionAgentConfig);
  ToolRegistry.registerToolFactory('action_agent', () => actionAgent);

  const actionAgentV1Config = createActionAgentV1Config();
  const actionAgentV1 = new ConfigurableAgentTool(actionAgentV1Config);
  ToolRegistry.registerToolFactory('action_agent_v1', () => actionAgentV1);

  const actionAgentV2Config = createActionAgentV2Config();
  const actionAgentV2 = new ConfigurableAgentTool(actionAgentV2Config);
  ToolRegistry.registerToolFactory('action_agent_v2', () => actionAgentV2);

  // Create and register Action Verification Agent
  const actionVerificationAgentConfig = createActionVerificationAgentConfig();
  const actionVerificationAgent = new ConfigurableAgentTool(actionVerificationAgentConfig);
  ToolRegistry.registerToolFactory('action_verification_agent', () => actionVerificationAgent);

  // Create and register specialized action agents
  const clickActionAgentConfig = createClickActionAgentConfig();
  const clickActionAgent = new ConfigurableAgentTool(clickActionAgentConfig);
  ToolRegistry.registerToolFactory('click_action_agent', () => clickActionAgent);

  const formFillActionAgentConfig = createFormFillActionAgentConfig();
  const formFillActionAgent = new ConfigurableAgentTool(formFillActionAgentConfig);
  ToolRegistry.registerToolFactory('form_fill_action_agent', () => formFillActionAgent);

  const keyboardInputActionAgentConfig = createKeyboardInputActionAgentConfig();
  const keyboardInputActionAgent = new ConfigurableAgentTool(keyboardInputActionAgentConfig);
  ToolRegistry.registerToolFactory('keyboard_input_action_agent', () => keyboardInputActionAgent);

  const hoverActionAgentConfig = createHoverActionAgentConfig();
  const hoverActionAgent = new ConfigurableAgentTool(hoverActionAgentConfig);
  ToolRegistry.registerToolFactory('hover_action_agent', () => hoverActionAgent);

  const scrollActionAgentConfig = createScrollActionAgentConfig();
  const scrollActionAgent = new ConfigurableAgentTool(scrollActionAgentConfig);
  ToolRegistry.registerToolFactory('scroll_action_agent', () => scrollActionAgent);

  // Create and register Web Task Agent
  const webTaskAgentConfig = createWebTaskAgentConfig();
  const webTaskAgent = new ConfigurableAgentTool(webTaskAgentConfig);
  ToolRegistry.registerToolFactory('web_task_agent', () => webTaskAgent);

  // Create and register E-commerce Product Information Assistant Agent
  const ecommerceProductInfoAgentConfig = createEcommerceProductInfoAgentConfig();
  const ecommerceProductInfoAgent = new ConfigurableAgentTool(ecommerceProductInfoAgentConfig);
  ToolRegistry.registerToolFactory('ecommerce_product_info_fetcher_tool', () => ecommerceProductInfoAgent);

  // Create and register Memory Agent (background memory consolidation)
  const memoryAgentConfig = createMemoryAgentConfig('extraction');
  const memoryAgent = new ConfigurableAgentTool(memoryAgentConfig);
  ToolRegistry.registerToolFactory('memory_agent', () => memoryAgent);

  // Create and register Search Memory Agent (read-only memory search for orchestrators)
  const searchMemoryAgentConfig = createMemoryAgentConfig('search');
  const searchMemoryAgent = new ConfigurableAgentTool(searchMemoryAgentConfig);
  ToolRegistry.registerToolFactory('search_memory_agent', () => searchMemoryAgent);

  // Initialize custom agents from Agent Studio
  await AgentStudioIntegration.initialize();
}
