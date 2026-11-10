// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from './Logger.js';
import { AgentStorageManager, type StoredAgentConfig } from './AgentStorageManager.js';
import { ConfigurableAgentTool, ToolRegistry, type AgentToolConfig } from '../agent_framework/ConfigurableAgentTool.js';

const logger = createLogger('AgentStudioIntegration');

/**
 * Display information for an agent (used in Agent Studio UI)
 */
export interface AgentDisplayInfo {
  name: string;
  displayName: string;
  description: string;
  avatar: string;
  color: string;
  backgroundColor: string;
  isBuiltIn: boolean;
  id?: string; // Only for custom agents
  tools: string[];
  maxIterations: number;
  temperature: number;
  systemPrompt: string;
  version: string;
  schema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * List of built-in agent names (registered in ConfiguredAgents.ts)
 */
const BUILT_IN_AGENTS = [
  'direct_url_navigator_agent',
  'research_agent',
  'search_agent',
  'content_writer_agent',
  'action_agent',
  'action_verification_agent',
  'click_action_agent',
  'form_fill_action_agent',
  'keyboard_input_action_agent',
  'hover_action_agent',
  'scroll_action_agent',
  'web_task_agent',
  'ecommerce_product_info_fetcher_tool',
];

/**
 * Tracks registered custom agents for cleanup
 */
const registeredCustomAgents = new Set<string>();

/**
 * Integrates custom agents from Agent Studio with the existing agent system.
 * Handles registration, refresh, and provides unified access to all agents.
 */
export class AgentStudioIntegration {
  private static initialized = false;

  /**
   * Initialize custom agents into ToolRegistry on startup.
   * Should be called from initializeConfiguredAgents().
   */
  static async initialize(): Promise<void> {
    if (this.initialized) {
      logger.info('AgentStudioIntegration already initialized');
      return;
    }

    try {
      const storage = AgentStorageManager.getInstance();
      const customAgents = await storage.getAllAgents();

      for (const agentConfig of customAgents) {
        this.registerCustomAgent(agentConfig);
      }

      this.initialized = true;
      logger.info(`Initialized ${customAgents.length} custom agents from Agent Studio`);
    } catch (error) {
      logger.error('Failed to initialize custom agents:', error);
      // Don't block startup if custom agents fail to load
      this.initialized = true;
    }
  }

  /**
   * Refresh custom agents after changes in Agent Studio.
   * Unregisters removed agents and registers new/updated ones.
   */
  static async refreshAgents(): Promise<void> {
    try {
      const storage = AgentStorageManager.getInstance();
      const customAgents = await storage.getAllAgents();
      const currentNames = new Set(customAgents.map(a => a.name));

      // Unregister agents that no longer exist
      for (const name of registeredCustomAgents) {
        if (!currentNames.has(name)) {
          this.unregisterCustomAgent(name);
        }
      }

      // Register or update all current custom agents
      for (const agentConfig of customAgents) {
        this.registerCustomAgent(agentConfig);
      }

      logger.info(`Refreshed custom agents: ${customAgents.length} active`);
    } catch (error) {
      logger.error('Failed to refresh custom agents:', error);
    }
  }

  /**
   * Get all agents (built-in + custom) for display in Agent Studio UI.
   */
  static async getAllAgentsForDisplay(): Promise<AgentDisplayInfo[]> {
    const agents: AgentDisplayInfo[] = [];

    // Add built-in agents
    for (const name of BUILT_IN_AGENTS) {
      const tool = ToolRegistry.getRegisteredTool(name);
      if (tool && tool instanceof ConfigurableAgentTool) {
        const config = tool.config;
        agents.push({
          name: config.name,
          displayName: config.ui?.displayName || this.formatAgentName(config.name),
          description: config.description,
          avatar: config.ui?.avatar || '🤖',
          color: config.ui?.color || '#00a4fe',
          backgroundColor: config.ui?.backgroundColor || '#e2f3fb',
          isBuiltIn: true,
          tools: config.tools,
          maxIterations: config.maxIterations || 10,
          temperature: config.temperature || 0,
          systemPrompt: config.systemPrompt,
          version: config.version || '1.0.0',
          schema: config.schema,
        });
      }
    }

    // Add custom agents
    try {
      const storage = AgentStorageManager.getInstance();
      const customAgents = await storage.getAllAgents();

      for (const stored of customAgents) {
        agents.push({
          name: stored.name,
          displayName: stored.ui.displayName,
          description: stored.description,
          avatar: stored.ui.avatar,
          color: stored.ui.color,
          backgroundColor: stored.ui.backgroundColor,
          isBuiltIn: false,
          id: stored.id,
          tools: stored.tools,
          maxIterations: stored.maxIterations,
          temperature: stored.temperature,
          systemPrompt: stored.systemPrompt,
          version: stored.version,
          schema: stored.schema,
        });
      }
    } catch (error) {
      logger.error('Failed to load custom agents for display:', error);
    }

    return agents;
  }

  /**
   * Get list of all available tool names for tool selection UI.
   */
  static getAvailableToolNames(): string[] {
    const toolNames: string[] = [];

    // Core tools (non-agent tools)
    const coreTools = [
      'navigate_url',
      'navigate_back',
      'node_ids_to_urls',
      'fetcher_tool',
      'extract_data',
      'extract_schema_streamlined',
      'finalize_with_critique',
      'perform_action',
      'get_page_content',
      'search_content',
      'take_screenshot',
      'html_to_markdown',
      'readability_extractor',
      'scroll_page',
      'wait_for_page_load',
      'thinking',
      'create_file',
      'update_file',
      'delete_file',
      'read_file',
      'list_files',
      'update_todo',
      'execute_code',
      'render_webapp',
      'get_webapp_data',
      'remove_webapp',
      'bookmark_store',
      'document_search',
      'save_research_report',
    ];

    for (const name of coreTools) {
      if (ToolRegistry.getRegisteredTool(name)) {
        toolNames.push(name);
      }
    }

    return toolNames.sort();
  }

  /**
   * Check if an agent name conflicts with built-in agents.
   */
  static isBuiltInAgentName(name: string): boolean {
    return BUILT_IN_AGENTS.includes(name);
  }

  /**
   * Convert StoredAgentConfig to AgentToolConfig for runtime use.
   */
  static toAgentToolConfig(stored: StoredAgentConfig): AgentToolConfig {
    return {
      name: stored.name,
      description: stored.description,
      version: stored.version,
      systemPrompt: stored.systemPrompt,
      tools: stored.tools,
      maxIterations: stored.maxIterations,
      temperature: stored.temperature,
      modelName: stored.modelName,
      schema: stored.schema,
      ui: stored.ui,
      handoffs: [], // Custom agents don't support handoff editing
    };
  }

  /**
   * Register a custom agent with ToolRegistry.
   */
  private static registerCustomAgent(stored: StoredAgentConfig): void {
    try {
      // Check for conflicts with built-in agents
      if (this.isBuiltInAgentName(stored.name)) {
        logger.warn(`Cannot register custom agent "${stored.name}" - conflicts with built-in agent`);
        return;
      }

      const config = this.toAgentToolConfig(stored);
      const agent = new ConfigurableAgentTool(config);

      ToolRegistry.registerToolFactory(stored.name, () => agent);
      registeredCustomAgents.add(stored.name);

      logger.info(`Registered custom agent: ${stored.name}`);
    } catch (error) {
      logger.error(`Failed to register custom agent "${stored.name}":`, error);
    }
  }

  /**
   * Unregister a custom agent from ToolRegistry.
   * Note: ToolRegistry doesn't support unregistration, so we just track it.
   */
  private static unregisterCustomAgent(name: string): void {
    registeredCustomAgents.delete(name);
    logger.info(`Marked custom agent as unregistered: ${name}`);
    // Note: Actual removal from ToolRegistry would require adding an unregister method
  }

  /**
   * Format agent name for display (snake_case to Title Case).
   */
  private static formatAgentName(name: string): string {
    return name
      .split(/[_-]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
