// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../../../core/Logger.js';
import { AgentStorageManager, type CreateAgentInput, type SchemaProperty } from '../../../core/AgentStorageManager.js';
import { AgentStudioIntegration, type AgentDisplayInfo } from '../../../core/AgentStudioIntegration.js';
import { ToolRegistry } from '../../../agent_framework/ConfigurableAgentTool.js';
import type {
  MiniApp,
  MiniAppSPA,
  MiniAppController,
  MiniAppBridge,
  MiniAppState,
  MiniAppActionSchema,
  MiniAppStateSchema,
  SPAToDevToolsAction,
} from '../../types/MiniAppTypes.js';
import { MiniAppEventBus } from '../../MiniAppEventBus.js';
import { AgentStudioSPA } from '../../../ui/agent_studio/AgentStudioSPA.js';

const logger = createLogger('AgentStudioMiniApp');

/**
 * Agent info for the SPA
 */
interface AgentInfo {
  id?: string;
  name: string;
  displayName: string;
  description: string;
  avatar: string;
  color: string;
  backgroundColor: string;
  isBuiltIn: boolean;
  tools: string[];
  maxIterations: number;
  temperature: number;
  systemPrompt: string;
  version: string;
  schema: object;
}

/**
 * Tool info for the SPA
 */
interface ToolInfo {
  name: string;
  description: string;
}

/**
 * Form data for saving agents
 */
interface AgentFormData {
  name: string;
  displayName: string;
  description: string;
  avatar: string;
  color: string;
  systemPrompt: string;
  tools: string[];
  maxIterations: number;
  temperature: number;
  schema: object;
}

/**
 * AgentStudioMiniApp - Wrapper for Agent Studio as a mini app
 *
 * This wraps the existing AgentStudio SPA to work with the mini app system
 * while maintaining backward compatibility with the existing implementation.
 */
export class AgentStudioMiniApp implements MiniApp {
  id = 'agent_studio';
  name = 'Agent Studio';
  description = 'Create and manage custom AI agents with configurable tools, prompts, and behaviors. View built-in agents or create custom ones.';
  icon = '🤖';

  getSPA(): MiniAppSPA {
    return {
      html: AgentStudioSPA.html,
      css: AgentStudioSPA.css,
      // We need to use the existing JS since it already has the agentStudio binding
      // The MiniAppRegistry will wrap this with the miniApp protocol
      js: AgentStudioSPA.js,
    };
  }

  getSupportedActions(): MiniAppActionSchema[] {
    return [
      {
        name: 'select-agent',
        description: 'Select an agent by name to view or edit',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The agent name to select' },
          },
          required: ['name'],
        },
      },
      {
        name: 'create-agent',
        description: 'Start creating a new custom agent',
        schema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'save-agent',
        description: 'Save the current agent configuration',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Agent name (lowercase, hyphens/underscores)' },
            displayName: { type: 'string', description: 'Human-readable display name' },
            description: { type: 'string', description: 'Agent description' },
            systemPrompt: { type: 'string', description: 'System prompt for the agent' },
            tools: { type: 'array', description: 'List of tool names the agent can use' },
            maxIterations: { type: 'number', description: 'Maximum iterations (1-100)' },
            temperature: { type: 'number', description: 'LLM temperature (0-2)' },
          },
          required: ['name', 'systemPrompt', 'tools'],
        },
      },
      {
        name: 'delete-agent',
        description: 'Delete the currently selected custom agent',
        schema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'list-agents',
        description: 'Get a list of all agents (built-in and custom)',
        schema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'list-tools',
        description: 'Get a list of all available tools',
        schema: {
          type: 'object',
          properties: {},
        },
      },
    ];
  }

  getStateSchema(): MiniAppStateSchema {
    return {
      type: 'object',
      properties: {
        agents: {
          type: 'array',
          description: 'List of all agents (built-in and custom)',
        },
        tools: {
          type: 'array',
          description: 'List of available tools',
        },
        selectedAgent: {
          type: 'object',
          description: 'Currently selected agent or null',
        },
        isCreatingNew: {
          type: 'boolean',
          description: 'Whether a new agent is being created',
        },
      },
    };
  }

  createController(): MiniAppController {
    return new AgentStudioMiniAppController();
  }
}

/**
 * Controller for Agent Studio mini app
 *
 * Handles business logic and bridges between the mini app system
 * and the existing Agent Studio infrastructure.
 */
class AgentStudioMiniAppController implements MiniAppController {
  private bridge: MiniAppBridge | null = null;
  private closeCallback: (() => void | Promise<void>) | null = null;

  // State
  private selectedAgentId: string | null = null;
  private selectedAgentName: string | null = null;
  private isCreatingNew = false;

  async initialize(bridge: MiniAppBridge): Promise<void> {
    this.bridge = bridge;
    bridge.onAction(this.handleAction.bind(this));
    logger.info('AgentStudioMiniAppController initialized');
  }

  async cleanup(): Promise<void> {
    this.bridge = null;
    this.selectedAgentId = null;
    this.selectedAgentName = null;
    this.isCreatingNew = false;
    logger.info('AgentStudioMiniAppController cleaned up');
  }

  onClose(callback: () => void | Promise<void>): void {
    this.closeCallback = callback;
  }

  async getState(): Promise<MiniAppState> {
    const { agents, tools } = await this.loadAllData();

    let selectedAgent: AgentInfo | null = null;
    if (this.selectedAgentName) {
      const allAgents = await AgentStudioIntegration.getAllAgentsForDisplay();
      const agent = allAgents.find(a => a.name === this.selectedAgentName);
      if (agent) {
        selectedAgent = this.toAgentInfo(agent);
      }
    }

    return {
      agents,
      tools,
      selectedAgent,
      isCreatingNew: this.isCreatingNew,
    };
  }

  async setState(state: MiniAppState): Promise<void> {
    // Agent Studio state is mostly read-only from external perspective
    // State changes happen through actions
    if (state.selectedAgentName) {
      this.selectedAgentName = state.selectedAgentName as string;
    }
    if (state.isCreatingNew !== undefined) {
      this.isCreatingNew = state.isCreatingNew as boolean;
    }
  }

  async updateState(updates: Partial<MiniAppState>): Promise<void> {
    if (updates.selectedAgentName) {
      this.selectedAgentName = updates.selectedAgentName as string;
    }
    if (updates.isCreatingNew !== undefined) {
      this.isCreatingNew = updates.isCreatingNew as boolean;
    }
  }

  async executeAction(actionName: string, args: unknown): Promise<unknown> {
    const argsObj = args as Record<string, unknown>;

    switch (actionName) {
      case 'select-agent':
        return this.handleSelectAgentAction(argsObj.name as string);

      case 'create-agent':
        return this.handleNewAgentAction();

      case 'save-agent':
        return this.handleSaveAgentAction(argsObj as unknown as AgentFormData);

      case 'delete-agent':
        return this.handleDeleteAgentAction();

      case 'list-agents':
        return this.handleListAgentsAction();

      case 'list-tools':
        return this.handleListToolsAction();

      default:
        throw new Error(`Unknown action: ${actionName}`);
    }
  }

  // ============================================================================
  // SPA Action Handlers (from the SPA via bridge)
  // ============================================================================

  async handleAction(action: SPAToDevToolsAction): Promise<void> {
    logger.info('Handling SPA action:', action.type);

    switch (action.type) {
      case 'ready':
        await this.pushInitialState();
        break;

      case 'select-agent': {
        // SPA sends: { type: 'select-agent', name, id, isBuiltIn }
        const actionData = action as SPAToDevToolsAction & { name: string; id: string | null; isBuiltIn: boolean };
        await this.handleSelectAgent(actionData.name, actionData.id, actionData.isBuiltIn);
        break;
      }

      case 'new-agent':
        await this.handleNewAgent();
        break;

      case 'save-agent': {
        // SPA sends: { type: 'save-agent', data: AgentFormData }
        const actionData = action as SPAToDevToolsAction & { data: AgentFormData };
        await this.handleSaveAgent(actionData.data);
        break;
      }

      case 'delete-agent':
        await this.handleDeleteAgent();
        break;

      case 'clone-agent':
        await this.handleCloneAgent();
        break;

      case 'run-test': {
        // SPA sends: { type: 'run-test', query: string }
        const actionData = action as SPAToDevToolsAction & { query: string };
        await this.handleRunTest(actionData.query);
        break;
      }

      case 'close':
        if (this.closeCallback) {
          await this.closeCallback();
        }
        break;

      case 'state-changed':
        // State changed from SPA
        MiniAppEventBus.getInstance().emitStateChanged('agent_studio', action.payload);
        break;

      default:
        logger.warn('Unknown SPA action type:', action.type);
    }
  }

  // ============================================================================
  // Action Implementations (for executeAction)
  // ============================================================================

  private async handleSelectAgentAction(name: string): Promise<{ success: boolean; agent?: AgentInfo }> {
    const allAgents = await AgentStudioIntegration.getAllAgentsForDisplay();
    const agent = allAgents.find(a => a.name === name);

    if (!agent) {
      return { success: false };
    }

    this.selectedAgentName = name;
    this.selectedAgentId = agent.id || null;
    this.isCreatingNew = false;

    // Update SPA
    await this.bridge?.sendToSPA({
      action: 'agent-selected',
      payload: { agent: this.toAgentInfo(agent) },
    });

    return { success: true, agent: this.toAgentInfo(agent) };
  }

  private async handleNewAgentAction(): Promise<{ success: boolean }> {
    this.isCreatingNew = true;
    this.selectedAgentId = null;
    this.selectedAgentName = null;

    await this.bridge?.sendToSPA({
      action: 'agent-selected',
      payload: { agent: this.createEmptyAgent() },
    });

    return { success: true };
  }

  private async handleSaveAgentAction(data: AgentFormData): Promise<{ success: boolean; agent?: AgentInfo; error?: string }> {
    try {
      const storageManager = AgentStorageManager.getInstance();

      const input: CreateAgentInput = {
        name: data.name,
        description: data.description || '',
        version: '1.0.0',
        systemPrompt: data.systemPrompt,
        tools: data.tools,
        maxIterations: data.maxIterations || 10,
        temperature: data.temperature || 0.7,
        schema: (data.schema as { type: string; properties: Record<string, SchemaProperty>; required?: string[] }) || {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The user query' },
          },
          required: ['query'],
        },
        ui: {
          displayName: data.displayName || data.name,
          avatar: data.avatar || '🤖',
          color: data.color || '#3b82f6',
          backgroundColor: '#e0e7ff',
        },
      };

      let savedAgent;
      if (this.isCreatingNew) {
        savedAgent = await storageManager.createAgent(input);
      } else if (this.selectedAgentId) {
        savedAgent = await storageManager.updateAgent(this.selectedAgentId, input);
      } else {
        return { success: false, error: 'No agent selected to update' };
      }

      // Refresh the tool registry
      await AgentStudioIntegration.refreshAgents();

      // Update state
      this.selectedAgentId = savedAgent.id;
      this.selectedAgentName = savedAgent.name;
      this.isCreatingNew = false;

      return { success: true, agent: this.toAgentInfo(savedAgent as unknown as AgentDisplayInfo) };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
    }
  }

  private async handleDeleteAgentAction(): Promise<{ success: boolean; error?: string }> {
    if (!this.selectedAgentId) {
      return { success: false, error: 'No agent selected' };
    }

    try {
      const storageManager = AgentStorageManager.getInstance();
      await storageManager.deleteAgent(this.selectedAgentId);

      // Refresh the tool registry
      await AgentStudioIntegration.refreshAgents();

      // Clear selection
      this.selectedAgentId = null;
      this.selectedAgentName = null;

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
    }
  }

  private async handleListAgentsAction(): Promise<{ agents: AgentInfo[] }> {
    const { agents } = await this.loadAllData();
    return { agents };
  }

  private async handleListToolsAction(): Promise<{ tools: ToolInfo[] }> {
    const { tools } = await this.loadAllData();
    return { tools };
  }

  // ============================================================================
  // SPA-Triggered Handlers (legacy compatibility)
  // ============================================================================

  private async pushInitialState(): Promise<void> {
    const { agents, tools } = await this.loadAllData();

    await this.bridge?.sendToSPA({
      action: 'init',
      payload: {
        agents,
        tools,
        selectedAgent: undefined,
      },
    });

    logger.info('Initial state pushed to SPA');
  }

  private async handleSelectAgent(name: string, id: string | null, _isBuiltIn: boolean): Promise<void> {
    this.isCreatingNew = false;
    this.selectedAgentName = name;
    this.selectedAgentId = id;

    const allAgents = await AgentStudioIntegration.getAllAgentsForDisplay();
    const agent = allAgents.find(a => a.name === name);

    if (agent) {
      await this.bridge?.sendToSPA({
        action: 'agent-selected',
        payload: { agent: this.toAgentInfo(agent) },
      });
    }
  }

  private async handleNewAgent(): Promise<void> {
    this.isCreatingNew = true;
    this.selectedAgentId = null;
    this.selectedAgentName = null;

    await this.bridge?.sendToSPA({
      action: 'agent-selected',
      payload: { agent: this.createEmptyAgent() },
    });
  }

  private async handleSaveAgent(data: AgentFormData): Promise<void> {
    const result = await this.handleSaveAgentAction(data);

    if (result.success) {
      // Reload agents list
      const { agents } = await this.loadAllData();
      await this.bridge?.sendToSPA({
        action: 'agents-updated',
        payload: { agents },
      });

      await this.bridge?.sendToSPA({
        action: 'notification',
        payload: { message: 'Agent saved successfully!', type: 'success' },
      });
    } else {
      await this.bridge?.sendToSPA({
        action: 'notification',
        payload: { message: result.error || 'Failed to save agent', type: 'error' },
      });
    }
  }

  private async handleDeleteAgent(): Promise<void> {
    const result = await this.handleDeleteAgentAction();

    if (result.success) {
      const { agents } = await this.loadAllData();
      await this.bridge?.sendToSPA({
        action: 'agents-updated',
        payload: { agents },
      });

      await this.bridge?.sendToSPA({
        action: 'notification',
        payload: { message: 'Agent deleted successfully!', type: 'success' },
      });
    } else {
      await this.bridge?.sendToSPA({
        action: 'notification',
        payload: { message: result.error || 'Failed to delete agent', type: 'error' },
      });
    }
  }

  private async handleCloneAgent(): Promise<void> {
    if (!this.selectedAgentName) {
      await this.bridge?.sendToSPA({
        action: 'notification',
        payload: { message: 'No agent selected to clone', type: 'error' },
      });
      return;
    }

    const allAgents = await AgentStudioIntegration.getAllAgentsForDisplay();
    const agent = allAgents.find(a => a.name === this.selectedAgentName);

    if (!agent) {
      await this.bridge?.sendToSPA({
        action: 'notification',
        payload: { message: 'Agent not found', type: 'error' },
      });
      return;
    }

    // Create a clone with modified name
    const cloneName = `${agent.name}_copy`;
    const cloneAgent: AgentInfo = {
      ...this.toAgentInfo(agent),
      id: undefined,
      name: cloneName,
      displayName: `${agent.displayName} (Copy)`,
      isBuiltIn: false,
    };

    this.isCreatingNew = true;
    this.selectedAgentId = null;
    this.selectedAgentName = null;

    await this.bridge?.sendToSPA({
      action: 'agent-selected',
      payload: { agent: cloneAgent },
    });

    await this.bridge?.sendToSPA({
      action: 'notification',
      payload: { message: 'Agent cloned. Save to create a new custom agent.', type: 'success' },
    });
  }

  private async handleRunTest(query: string): Promise<void> {
    // TODO: Implement agent testing
    logger.info('Running test with query:', query);

    await this.bridge?.sendToSPA({
      action: 'test-result',
      payload: { html: '<p>Agent testing is not yet implemented.</p>' },
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

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

  private createEmptyAgent(): AgentInfo {
    return {
      name: '',
      displayName: '',
      description: '',
      avatar: '🤖',
      color: '#3b82f6',
      backgroundColor: '#e0e7ff',
      isBuiltIn: false,
      tools: [],
      maxIterations: 10,
      temperature: 0.7,
      systemPrompt: '',
      version: '1.0.0',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The user query' },
        },
        required: ['query'],
      },
    };
  }
}
