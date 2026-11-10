// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { Tool, LLMContext } from './Tools.js';
import { ToolRegistry } from '../agent_framework/ConfigurableAgentTool.js';
import { AgentStudioIntegration } from '../core/AgentStudioIntegration.js';
import { createLogger } from '../core/Logger.js';

const logger = createLogger('CallCustomAgentTool');

/**
 * Input for calling a custom agent
 */
export interface CallCustomAgentInput {
  agent_name: string;
  args: Record<string, unknown>;
}

/**
 * Result from calling a custom agent
 */
export interface CallCustomAgentResult {
  result?: unknown;
  error?: string;
}

/**
 * Tool to execute a custom agent by name with dynamic arguments.
 *
 * This tool passes through any arguments to the target agent, allowing
 * custom agents to define their own input schemas. The caller should
 * first use search_custom_agents to discover available agents and their
 * schemas before calling this tool.
 *
 * Combined with SearchCustomAgentsTool, this implements Anthropic's
 * "Tool Search Tool" pattern for context-efficient agent discovery.
 */
export class CallCustomAgentTool implements Tool<CallCustomAgentInput, CallCustomAgentResult> {
  name = 'call_custom_agent';
  description = 'Execute a custom agent by name with arguments matching its schema. Use search_custom_agents first to discover available agents and their required input schemas.';

  schema = {
    type: 'object',
    properties: {
      agent_name: {
        type: 'string',
        description: 'The name of the custom agent to call (from search_custom_agents results)'
      },
      args: {
        type: 'object',
        description: 'Arguments to pass to the agent, matching the schema returned by search_custom_agents'
      }
    },
    required: ['agent_name', 'args']
  };

  async execute(input: CallCustomAgentInput, ctx?: LLMContext): Promise<CallCustomAgentResult> {
    try {
      logger.info('Calling custom agent', { agent: input.agent_name, args: input.args });

      // Validate this is a custom agent (not built-in)
      if (AgentStudioIntegration.isBuiltInAgentName(input.agent_name)) {
        return {
          error: `'${input.agent_name}' is a built-in agent. Use the appropriate built-in tool instead.`
        };
      }

      // Get the agent tool from registry
      const tool = ToolRegistry.getToolInstance(input.agent_name);

      if (!tool) {
        // Get available custom agents for helpful error message
        const allAgents = await AgentStudioIntegration.getAllAgentsForDisplay();
        const customAgents = allAgents.filter(a => !a.isBuiltIn);
        const availableNames = customAgents.map(a => a.name);

        return {
          error: `Custom agent '${input.agent_name}' not found. Use search_custom_agents to find available agents. Available: ${availableNames.length > 0 ? availableNames.join(', ') : 'none'}`
        };
      }

      // Execute the agent with passed-through args
      // The agent itself validates its own schema
      const result = await tool.execute(input.args, ctx);

      logger.info('Custom agent execution complete', { agent: input.agent_name });

      return { result };
    } catch (error) {
      logger.error('Custom agent execution failed:', error);
      return {
        error: `Execution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
