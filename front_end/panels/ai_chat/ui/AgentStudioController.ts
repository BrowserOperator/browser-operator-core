// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../core/Logger.js';
import { AgentStorageManager, type CreateAgentInput, type SchemaProperty } from '../core/AgentStorageManager.js';
import { AgentStudioIntegration, type AgentDisplayInfo } from '../core/AgentStudioIntegration.js';
import { ToolRegistry } from '../agent_framework/ConfigurableAgentTool.js';
import {
  AgentStudioBridge,
  type SPAAction,
  type AgentFormData,
  type AgentInfo,
  type ToolInfo,
} from './AgentStudioBridge.js';

const logger = createLogger('AgentStudioController');

/**
 * AgentStudioController - Manages state and business logic for Agent Studio
 *
 * Responsibilities:
 * - Handles all SPA actions (select, save, delete, clone, etc.)
 * - Manages agent state (selected agent, creating new)
 * - Communicates with AgentStorageManager for persistence
 * - Sends state updates to SPA via bridge
 */
export class AgentStudioController {
  private bridge: AgentStudioBridge;
  private selectedAgentId: string | null = null;
  private selectedAgentName: string | null = null;
  private isCreatingNew = false;
  private closeCallback: (() => void | Promise<void>) | null = null;

  constructor() {
    this.bridge = new AgentStudioBridge();
    this.bridge.onAction(this.handleAction.bind(this));
  }

  /**
   * Set callback for when close action is received
   */
  onClose(callback: () => void | Promise<void>): void {
    this.closeCallback = callback;
  }

  /**
   * Initialize the controller and install the bridge
   */
  async initialize(webappId: string): Promise<void> {
    await this.bridge.install(webappId);
    logger.info('Controller initialized');
  }

  /**
   * Cleanup - uninstall bridge and reset state
   */
  async cleanup(): Promise<void> {
    await this.bridge.uninstall();
    this.selectedAgentId = null;
    this.selectedAgentName = null;
    this.isCreatingNew = false;
    logger.info('Controller cleaned up');
  }

  /**
   * Push initial state to the SPA
   */
  async pushInitialState(): Promise<void> {
    const { agents, tools } = await this.loadAllData();

    await this.bridge.sendToSPA({
      action: 'init',
      payload: {
        agents,
        tools,
        selectedAgent: undefined,
      },
    });

    logger.info('Initial state pushed to SPA');
  }

  /**
   * Load all agents and tools
   */
  private async loadAllData(): Promise<{ agents: AgentInfo[]; tools: ToolInfo[] }> {
    const allAgents = await AgentStudioIntegration.getAllAgentsForDisplay();
    const agents: AgentInfo[] = allAgents.map(a => this.toAgentInfo(a));

    const toolNames = AgentStudioIntegration.getAvailableToolNames();
    const tools: ToolInfo[] = toolNames.map(name => {
      const tool = ToolRegistry.getRegisteredTool(name);
      return {
        name,
        description: tool?.description || 'No description available',
      };
    });

    return { agents, tools };
  }

  /**
   * Convert AgentDisplayInfo to AgentInfo
   */
  private toAgentInfo(agent: AgentDisplayInfo): AgentInfo {
    return {
      id: agent.id,
      name: agent.name,
      displayName: agent.displayName,
      description: agent.description,
      avatar: agent.avatar,
      color: agent.color,
      backgroundColor: agent.backgroundColor,
      isBuiltIn: agent.isBuiltIn,
      tools: agent.tools,
      maxIterations: agent.maxIterations,
      temperature: agent.temperature,
      systemPrompt: agent.systemPrompt,
      version: agent.version,
      schema: agent.schema,
    };
  }

  /**
   * Handle actions from the SPA
   */
  private async handleAction(action: SPAAction): Promise<void> {
    logger.info('Handling action:', action.type);

    switch (action.type) {
      case 'ready':
        await this.pushInitialState();
        break;

      case 'select-agent':
        await this.handleSelectAgent(action.name, action.id, action.isBuiltIn);
        break;

      case 'new-agent':
        await this.handleNewAgent();
        break;

      case 'save-agent':
        await this.handleSaveAgent(action.data);
        break;

      case 'delete-agent':
        await this.handleDeleteAgent();
        break;

      case 'clone-agent':
        await this.handleCloneAgent();
        break;

      case 'run-test':
        await this.handleRunTest(action.query);
        break;

      case 'close':
        if (this.closeCallback) {
          await this.closeCallback();
        }
        break;

      default:
        logger.warn('Unknown action type:', (action as SPAAction).type);
    }
  }

  /**
   * Handle selecting an agent
   */
  private async handleSelectAgent(name: string, id: string | null, isBuiltIn: boolean): Promise<void> {
    this.isCreatingNew = false;
    this.selectedAgentName = name;
    this.selectedAgentId = id;

    // Get full agent data
    const allAgents = await AgentStudioIntegration.getAllAgentsForDisplay();
    const agent = allAgents.find(a => a.name === name);

    if (agent) {
      await this.bridge.sendToSPA({
        action: 'agent-selected',
        payload: { agent: this.toAgentInfo(agent) },
      });
    }
  }

  /**
   * Handle creating a new agent
   */
  private async handleNewAgent(): Promise<void> {
    this.isCreatingNew = true;
    this.selectedAgentId = null;
    this.selectedAgentName = null;

    // Send empty agent template
    const emptyAgent: AgentInfo = {
      name: '',
      displayName: '',
      description: '',
      avatar: '🤖',
      color: '#00a4fe',
      backgroundColor: '#e2f3fb',
      isBuiltIn: false,
      tools: [],
      maxIterations: 10,
      temperature: 0,
      systemPrompt: '',
      version: '1.0.0',
      schema: { type: 'object', properties: {}, required: ['query', 'reasoning'] },
    };

    await this.bridge.sendToSPA({
      action: 'agent-selected',
      payload: { agent: emptyAgent },
    });
  }

  /**
   * Handle saving an agent
   */
  private async handleSaveAgent(data: AgentFormData): Promise<void> {
    try {
      const storage = AgentStorageManager.getInstance();

      if (this.isCreatingNew || !this.selectedAgentId) {
        // Create new agent
        const input: CreateAgentInput = {
          name: data.name,
          description: data.description || '',
          version: '1.0.0',
          systemPrompt: data.systemPrompt,
          tools: data.tools || [],
          maxIterations: data.maxIterations || 10,
          temperature: data.temperature || 0,
          schema: (data.schema && typeof data.schema === 'object' && 'type' in data.schema)
            ? data.schema as { type: string; properties: Record<string, SchemaProperty>; required?: string[] }
            : { type: 'object', properties: {}, required: [] },
          ui: {
            displayName: data.displayName || data.name,
            avatar: data.avatar || '🤖',
            color: data.color || '#00a4fe',
            backgroundColor: '#e2f3fb',
          },
        };

        const created = await storage.createAgent(input);
        this.selectedAgentId = created.id;
        this.selectedAgentName = created.name;
        this.isCreatingNew = false;

        logger.info('Created new agent:', created.name);
      } else {
        // Update existing agent
        await storage.updateAgent(this.selectedAgentId, {
          name: data.name,
          description: data.description || '',
          systemPrompt: data.systemPrompt,
          tools: data.tools || [],
          maxIterations: data.maxIterations || 10,
          temperature: data.temperature || 0,
          schema: (data.schema && typeof data.schema === 'object' && 'type' in data.schema)
            ? data.schema as { type: string; properties: Record<string, SchemaProperty>; required?: string[] }
            : { type: 'object', properties: {}, required: [] },
          ui: {
            displayName: data.displayName || data.name,
            avatar: data.avatar || '🤖',
            color: data.color || '#00a4fe',
            backgroundColor: '#e2f3fb',
          },
        });

        this.selectedAgentName = data.name;
        logger.info('Updated agent:', data.name);
      }

      // Refresh agents in ToolRegistry
      await AgentStudioIntegration.refreshAgents();

      // Refresh agents list in SPA
      const { agents, tools } = await this.loadAllData();
      await this.bridge.sendToSPA({
        action: 'agents-updated',
        payload: { agents },
      });

      // Send success notification
      await this.bridge.sendToSPA({
        action: 'notification',
        payload: { message: 'Agent saved successfully', type: 'success' },
      });
    } catch (error) {
      logger.error('Failed to save agent:', error);
      await this.bridge.sendToSPA({
        action: 'notification',
        payload: {
          message: `Failed to save agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
          type: 'error',
        },
      });
    }
  }

  /**
   * Handle deleting an agent
   */
  private async handleDeleteAgent(): Promise<void> {
    if (!this.selectedAgentId) {
      logger.warn('No agent selected for deletion');
      return;
    }

    try {
      const storage = AgentStorageManager.getInstance();
      await storage.deleteAgent(this.selectedAgentId);

      // Refresh agents in ToolRegistry
      await AgentStudioIntegration.refreshAgents();

      // Clear selection
      this.selectedAgentId = null;
      this.selectedAgentName = null;
      this.isCreatingNew = false;

      // Refresh agents list in SPA
      const { agents } = await this.loadAllData();
      await this.bridge.sendToSPA({
        action: 'agents-updated',
        payload: { agents },
      });

      // Clear the form
      await this.bridge.sendToSPA({
        action: 'agent-selected',
        payload: { agent: null as unknown as AgentInfo },
      });

      await this.bridge.sendToSPA({
        action: 'notification',
        payload: { message: 'Agent deleted successfully', type: 'success' },
      });

      logger.info('Agent deleted successfully');
    } catch (error) {
      logger.error('Failed to delete agent:', error);
      await this.bridge.sendToSPA({
        action: 'notification',
        payload: {
          message: `Failed to delete agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
          type: 'error',
        },
      });
    }
  }

  /**
   * Handle cloning a built-in agent
   */
  private async handleCloneAgent(): Promise<void> {
    if (!this.selectedAgentName) {
      logger.warn('No agent selected for cloning');
      return;
    }

    try {
      // Get the agent's data
      const allAgents = await AgentStudioIntegration.getAllAgentsForDisplay();
      const sourceAgent = allAgents.find(a => a.name === this.selectedAgentName);

      if (!sourceAgent) {
        throw new Error('Agent not found');
      }

      // Generate unique name
      let cloneName = `${sourceAgent.name}_custom`;
      let counter = 1;
      const storage = AgentStorageManager.getInstance();

      while (await storage.agentNameExists(cloneName) || AgentStudioIntegration.isBuiltInAgentName(cloneName)) {
        cloneName = `${sourceAgent.name}_custom_${counter}`;
        counter++;
      }

      // Create cloned agent
      const input: CreateAgentInput = {
        name: cloneName,
        description: `Clone of ${sourceAgent.displayName}`,
        version: '1.0.0',
        systemPrompt: sourceAgent.systemPrompt,
        tools: [...sourceAgent.tools],
        maxIterations: sourceAgent.maxIterations,
        temperature: sourceAgent.temperature,
        schema: JSON.parse(JSON.stringify(sourceAgent.schema)),
        ui: {
          displayName: `${sourceAgent.displayName} (Custom)`,
          avatar: sourceAgent.avatar,
          color: sourceAgent.color,
          backgroundColor: sourceAgent.backgroundColor,
        },
      };

      const created = await storage.createAgent(input);

      // Refresh agents in ToolRegistry
      await AgentStudioIntegration.refreshAgents();

      // Update state
      this.selectedAgentId = created.id;
      this.selectedAgentName = created.name;
      this.isCreatingNew = false;

      // Refresh agents list
      const { agents } = await this.loadAllData();
      await this.bridge.sendToSPA({
        action: 'agents-updated',
        payload: { agents },
      });

      // Select the new agent
      const newAgent = agents.find(a => a.name === created.name);
      if (newAgent) {
        await this.bridge.sendToSPA({
          action: 'agent-selected',
          payload: { agent: newAgent },
        });
      }

      await this.bridge.sendToSPA({
        action: 'notification',
        payload: { message: `Agent cloned as "${created.name}"`, type: 'success' },
      });

      logger.info('Cloned agent:', created.name);
    } catch (error) {
      logger.error('Failed to clone agent:', error);
      await this.bridge.sendToSPA({
        action: 'notification',
        payload: {
          message: `Failed to clone agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
          type: 'error',
        },
      });
    }
  }

  /**
   * Handle running a test
   */
  private async handleRunTest(query: string): Promise<void> {
    // For now, just show a placeholder result
    // Full implementation would use AgentTestRunner
    const resultHTML = `
      <div style="font-family: monospace; font-size: 13px;">
        <div style="color: #666; margin-bottom: 8px;">Test execution is not yet implemented.</div>
        <div style="color: #333;"><strong>Query:</strong> ${this.escapeHTML(query)}</div>
      </div>
    `;

    await this.bridge.sendToSPA({
      action: 'test-result',
      payload: { html: resultHTML },
    });
  }

  /**
   * Get the bridge for external access (e.g., for close handling)
   */
  getBridge(): AgentStudioBridge {
    return this.bridge;
  }

  /**
   * Helper to escape HTML
   */
  private escapeHTML(str: string): string {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
