// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { Tool, LLMContext } from './Tools.js';
import { getAdapter } from '../cdp/getAdapter.js';
import { createLogger } from '../core/Logger.js';
import type {
  SearchToolArgs,
  SearchToolResult,
  SearchPattern,
  SearchStrategyType,
} from './search/types.js';
import { DEFAULT_MAX_RESULTS } from './search/types.js';
import { SearchPatternCache } from './search/SearchPatternCache.js';
import {
  getPreferredStrategy,
  getStrategy,
  getSiteConfig,
  getSearchUrl,
} from './search/SearchStrategy.js';

const logger = createLogger('SearchTool');

/**
 * SearchTool - Performs web searches and extracts structured results
 *
 * This tool:
 * 1. Takes a search query and target site
 * 2. Navigates to the site's search results page
 * 3. Extracts structured results (title, URL, snippet, position)
 * 4. Caches extraction patterns for reuse across searches
 *
 * The tool uses pluggable strategies for extraction:
 * - xpath-schema: Uses accessibility tree + SchemaBasedExtractorTool + CSS selector caching (default)
 * - semantic-xpath: Uses XPath with ARIA roles and text content (more resilient to CSS changes)
 * - encoded-id: Parses accessibility tree directly by role/URL patterns (fastest execution)
 * - text-pattern: Uses URL exclusion patterns and text filters (most stable)
 * - cdp: Uses CDP DOM APIs (future)
 * - js-eval: Uses JavaScript evaluation (future)
 */
export class SearchTool implements Tool<SearchToolArgs, SearchToolResult> {
  name = 'search';

  description = `Performs a web search on a specified site and returns structured results.

Takes a search query and site (e.g., "google.com", "amazon.com", "github.com") and returns:
- title: Result title
- url: Result URL
- snippet: Description/snippet text
- position: Position in results (1-indexed)
- additionalFields: Site-specific data (price for Amazon, stars for GitHub, etc.)

The tool caches extraction patterns per-site for faster subsequent searches.

Supported sites: Google, Bing, Amazon, Wikipedia, GitHub (and any site with a search form).

Examples:
- Search Google: search({ query: "react hooks tutorial", site: "google.com", reasoning: "Finding tutorials" })
- Search Amazon: search({ query: "wireless headphones", site: "amazon.com", reasoning: "Finding products" })
- Search GitHub: search({ query: "machine learning python", site: "github.com", reasoning: "Finding repositories" })`;

  schema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query text',
      },
      site: {
        type: 'string',
        description: 'Site to search (e.g., "google.com", "amazon.com")',
      },
      maxResults: {
        type: 'number',
        description: `Maximum results to return (default: ${DEFAULT_MAX_RESULTS})`,
      },
      forceRefresh: {
        type: 'boolean',
        description: 'Force pattern regeneration even if cached',
      },
      strategy: {
        type: 'string',
        enum: ['xpath-schema', 'semantic-xpath', 'encoded-id', 'text-pattern', 'cdp', 'js-eval'],
        description: 'Override extraction strategy: xpath-schema (LLM + CSS cache), semantic-xpath (ARIA roles), encoded-id (a11y tree parsing), text-pattern (URL filters)',
      },
      reasoning: {
        type: 'string',
        description: 'Reasoning for the search (displayed to user)',
      },
    },
    required: ['query', 'site', 'reasoning'],
  };

  private cache = SearchPatternCache.getInstance();

  async execute(args: SearchToolArgs, ctx?: LLMContext): Promise<SearchToolResult> {
    const startTime = Date.now();
    logger.info(`Executing search: "${args.query}" on ${args.site}`);

    try {
      // Validate arguments
      if (!args.query || args.query.trim().length === 0) {
        return {
          success: false,
          results: [],
          cached: false,
          error: 'Search query is required',
        };
      }

      if (!args.site || args.site.trim().length === 0) {
        return {
          success: false,
          results: [],
          cached: false,
          error: 'Site is required',
        };
      }

      // Get CDP adapter
      const adapter = await getAdapter(ctx);
      if (!adapter) {
        return {
          success: false,
          results: [],
          cached: false,
          error: 'No browser connection available',
        };
      }

      // Normalize site
      const normalizedSite = this.normalizeSite(args.site);
      const maxResults = args.maxResults || DEFAULT_MAX_RESULTS;

      // Check for cached pattern
      let pattern: SearchPattern | null = null;
      let cached = false;

      if (!args.forceRefresh) {
        pattern = await this.cache.getPattern(normalizedSite);
        if (pattern) {
          logger.debug(`Found cached pattern for ${normalizedSite}`);
          cached = true;
        }
      }

      // Get strategy
      const strategyType: SearchStrategyType = args.strategy ||
        (pattern?.strategy) ||
        (getSiteConfig(normalizedSite)?.preferredStrategy) ||
        'xpath-schema';

      const strategy = getStrategy(strategyType) || getPreferredStrategy(normalizedSite);
      logger.debug(`Using strategy: ${strategy.name}`);

      // Generate pattern if not cached
      if (!pattern) {
        logger.info(`No cached pattern, generating new pattern for ${normalizedSite}`);

        const generationResult = await strategy.generatePattern(
          {
            site: normalizedSite,
            sampleQuery: args.query,
            strategy: strategyType,
          },
          adapter,
          ctx
        );

        if (!generationResult.success || !generationResult.pattern) {
          return {
            success: false,
            results: [],
            cached: false,
            error: generationResult.error || 'Failed to generate search pattern',
          };
        }

        // Save pattern to cache
        pattern = await this.cache.savePattern(generationResult.pattern);
        logger.info(`Saved new pattern for ${normalizedSite}`);
      }

      // Execute pattern to extract results
      const executionResult = await strategy.executePattern(
        {
          pattern,
          query: args.query,
          maxResults,
        },
        adapter,
        ctx
      );

      const duration = Date.now() - startTime;

      if (!executionResult.success) {
        // Record failure (don't let cache errors block the result)
        try {
          await this.cache.recordFailure(pattern.id);
        } catch (cacheError) {
          logger.warn('Failed to record cache failure:', cacheError);
        }

        return {
          success: false,
          results: [],
          pattern,
          cached,
          metadata: {
            site: normalizedSite,
            query: args.query,
            resultCount: 0,
            strategy: strategyType,
            executionTimeMs: duration,
          },
          error: executionResult.error || 'Failed to extract search results',
        };
      }

      // Record success (don't let cache errors block the result)
      try {
        await this.cache.recordSuccess(pattern.id);
      } catch (cacheError) {
        logger.warn('Failed to record cache success:', cacheError);
      }

      return {
        success: true,
        results: executionResult.results,
        pattern,
        cached,
        metadata: {
          site: normalizedSite,
          query: args.query,
          resultCount: executionResult.results.length,
          strategy: strategyType,
          executionTimeMs: duration,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Search failed:', error);

      return {
        success: false,
        results: [],
        cached: false,
        metadata: {
          site: this.normalizeSite(args.site),
          query: args.query,
          resultCount: 0,
          strategy: args.strategy || 'xpath-schema',
          executionTimeMs: duration,
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Export cached patterns to JSON (for debugging)
   */
  async exportPatterns(): Promise<string> {
    return this.cache.exportToJSON();
  }

  /**
   * Import patterns from JSON (for debugging/testing)
   */
  async importPatterns(json: string): Promise<number> {
    return this.cache.importFromJSON(json);
  }

  /**
   * Clear all cached patterns
   */
  async clearCache(): Promise<void> {
    return this.cache.clearCache();
  }

  /**
   * Normalize site identifier
   */
  private normalizeSite(site: string): string {
    // Remove protocol
    let normalized = site.replace(/^https?:\/\//, '');
    // Remove www prefix
    normalized = normalized.replace(/^www\./, '');
    // Remove path and query string
    normalized = normalized.split('/')[0];
    normalized = normalized.split('?')[0];
    // Convert to lowercase
    normalized = normalized.toLowerCase();
    return normalized;
  }
}

// Re-export types for external use
export type { SearchToolArgs, SearchToolResult, SearchResult, SearchPattern } from './search/types.js';
