// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { Tool, LLMContext } from './Tools.js';
import { AgentStudioIntegration, type AgentDisplayInfo } from '../core/AgentStudioIntegration.js';
import { callLLMWithTracing } from './LLMTracingWrapper.js';
import { createLogger } from '../core/Logger.js';

const logger = createLogger('SearchCustomAgentsTool');

/**
 * Input for searching custom agents
 */
export interface SearchCustomAgentsInput {
  query: string;
}

/**
 * A matched agent with its schema
 */
export interface MatchedAgent {
  name: string;
  displayName: string;
  description: string;
  schema: object;
}

/**
 * Result from searching custom agents
 */
export interface SearchCustomAgentsResult {
  agents: MatchedAgent[];
  message?: string;
}

/**
 * Tool to search for custom agents using LLM-based semantic matching.
 *
 * Based on Anthropic's "Tool Search Tool" pattern for context-efficient
 * dynamic tool discovery. Instead of loading all custom agent definitions
 * into context, this tool:
 *
 * 1. Sends only agent names + descriptions to a fast LLM for routing
 * 2. Returns full schemas only for the top matching agents (max 3)
 *
 * This keeps context size constant regardless of how many custom agents exist.
 */
export class SearchCustomAgentsTool implements Tool<SearchCustomAgentsInput, SearchCustomAgentsResult> {
  name = 'search_custom_agents';
  description = 'Search for custom agents that can help with a task. Returns matching agents with their input schemas. Use this to discover what custom agents are available before calling them with call_custom_agent.';

  schema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What you want to accomplish (e.g., "check prices", "analyze data", "summarize content")'
      }
    },
    required: ['query']
  };

  async execute(input: SearchCustomAgentsInput, ctx?: LLMContext): Promise<SearchCustomAgentsResult> {
    try {
      logger.info('Searching custom agents', { query: input.query });

      // Get all agents and filter to custom only
      const allAgents = await AgentStudioIntegration.getAllAgentsForDisplay();
      const customAgents = allAgents.filter(a => !a.isBuiltIn);

      if (customAgents.length === 0) {
        return {
          agents: [],
          message: 'No custom agents available. Create custom agents in Agent Studio first.'
        };
      }

      // Build compact catalog for LLM (name + description only)
      const catalog = customAgents.map(a => ({
        name: a.name,
        description: a.description
      }));

      // Use LLM to find relevant agents
      const matchingNames = await this.findRelevantAgents(input.query, catalog, ctx);

      // Return full info for matched agents only (limit to top 3)
      const matches: MatchedAgent[] = matchingNames
        .map(name => customAgents.find(a => a.name === name))
        .filter((a): a is AgentDisplayInfo => a !== undefined)
        .slice(0, 3)
        .map(a => ({
          name: a.name,
          displayName: a.displayName,
          description: a.description,
          schema: a.schema
        }));

      if (matches.length === 0) {
        return {
          agents: [],
          message: `No custom agents found matching "${input.query}". Available agents: ${customAgents.map(a => a.name).join(', ')}`
        };
      }

      logger.info('Found matching agents', { count: matches.length, names: matches.map(m => m.name) });

      return { agents: matches };
    } catch (error) {
      logger.error('Search custom agents failed:', error);
      return {
        agents: [],
        message: `Search failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Use LLM to semantically match user query to available agents
   */
  private async findRelevantAgents(
    query: string,
    catalog: Array<{ name: string; description: string }>,
    ctx?: LLMContext
  ): Promise<string[]> {
    // If no LLM context, fall back to simple keyword matching
    if (!ctx?.provider || !ctx.model) {
      logger.warn('No LLM context available, falling back to keyword matching');
      return this.keywordMatch(query, catalog);
    }

    const prompt = `You are a routing assistant. Given a user request, identify which custom agents could help.

USER REQUEST: "${query}"

AVAILABLE CUSTOM AGENTS:
${catalog.map(a => `- ${a.name}: ${a.description}`).join('\n')}

Return a JSON array of agent names that could help with this request, most relevant first.
If no agents match, return an empty array [].
Only return the JSON array, nothing else.

Example response: ["agent_name_1", "agent_name_2"]`;

    try {
      const response = await callLLMWithTracing(
        {
          provider: ctx.provider,
          model: ctx.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          options: { retryConfig: { maxRetries: 2 } }
        },
        {
          toolName: this.name,
          operationName: 'agent_routing',
          context: 'custom_agent_discovery',
          additionalMetadata: {
            query,
            catalogSize: catalog.length
          }
        }
      );

      if (!response.text) {
        logger.warn('Empty LLM response, falling back to keyword matching');
        return this.keywordMatch(query, catalog);
      }

      // Parse JSON array from response
      const text = response.text.trim();
      // Handle potential markdown code blocks
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.warn('Could not find JSON array in response, falling back to keyword matching');
        return this.keywordMatch(query, catalog);
      }

      const names = JSON.parse(jsonMatch[0]) as string[];

      // Validate that returned names exist in catalog
      const validNames = names.filter(name =>
        catalog.some(a => a.name === name)
      );

      return validNames;
    } catch (error) {
      logger.error('LLM routing failed, falling back to keyword matching:', error);
      return this.keywordMatch(query, catalog);
    }
  }

  /**
   * Simple keyword matching fallback when LLM is not available
   */
  private keywordMatch(
    query: string,
    catalog: Array<{ name: string; description: string }>
  ): string[] {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    const scored = catalog.map(agent => {
      const nameLower = agent.name.toLowerCase();
      const descLower = agent.description.toLowerCase();
      let score = 0;

      // Exact query match in name or description
      if (nameLower.includes(queryLower)) score += 10;
      if (descLower.includes(queryLower)) score += 5;

      // Word overlap
      for (const word of queryWords) {
        if (nameLower.includes(word)) score += 3;
        if (descLower.includes(word)) score += 1;
      }

      return { name: agent.name, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.name);
  }
}
