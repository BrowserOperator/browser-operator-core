// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { CDPSessionAdapter } from '../../cdp/CDPSessionAdapter.js';
import type { LLMContext } from '../Tools.js';
import type {
  SearchPattern,
  SearchResult,
  PatternGenerationOptions,
  PatternGenerationResult,
  PatternExecutionOptions,
  PatternExecutionResult,
  SearchStrategyType,
  XPathPattern,
  SiteConfig,
  SelectorScore,
  SemanticXPathPattern,
  EncodedIdPattern,
  TextContentPattern,
} from './types.js';
import { PATTERN_SCHEMA_VERSION, DEFAULT_MAX_RESULTS } from './types.js';
import { createLogger } from '../../core/Logger.js';
import { type EncodedId } from '../../common/context.js';
import { captureHybridSnapshotUniversal, type HybridSnapshot } from '../../a11y/HybridSnapshotUniversal.js';
import { SchemaBasedExtractorTool, type SchemaDefinition } from '../SchemaBasedExtractorTool.js';
import { callLLMWithTracing } from '../LLMTracingWrapper.js';

const logger = createLogger('SearchStrategy');

/** Track sites currently generating selectors to prevent race conditions */
const selectorGenerationInProgress = new Set<string>();

/**
 * Interface for search extraction strategies
 */
export interface SearchStrategy {
  /** Strategy name */
  name: SearchStrategyType;
  /** Human-readable description */
  description: string;
  /** Priority for fallback ordering (lower = higher priority) */
  priority: number;

  /**
   * Generate a pattern for a site
   */
  generatePattern(
    options: PatternGenerationOptions,
    adapter: CDPSessionAdapter,
    ctx?: LLMContext
  ): Promise<PatternGenerationResult>;

  /**
   * Execute a pattern to extract results
   */
  executePattern(
    options: PatternExecutionOptions,
    adapter: CDPSessionAdapter,
    ctx?: LLMContext
  ): Promise<PatternExecutionResult>;
}

/**
 * Well-known site configurations
 */
export const SITE_CONFIGS: SiteConfig[] = [
  {
    site: 'google.com',
    displayName: 'Google',
    searchUrl: 'https://www.google.com/search?q={query}',
    preferredStrategy: 'xpath-schema',
    hints: {
      searchInputHint: 'searchbox or textbox with name containing "search"',
      resultsContainerHint: 'main search results container',
      waitTimeMs: 3000,
    },
  },
  {
    site: 'bing.com',
    displayName: 'Bing',
    searchUrl: 'https://www.bing.com/search?q={query}',
    preferredStrategy: 'xpath-schema',
    hints: {
      searchInputHint: 'search input field',
      resultsContainerHint: 'search results list',
      waitTimeMs: 3000,
    },
  },
  {
    site: 'amazon.com',
    displayName: 'Amazon',
    searchUrl: 'https://www.amazon.com/s?k={query}',
    preferredStrategy: 'xpath-schema',
    hints: {
      searchInputHint: 'search textbox',
      resultsContainerHint: 'product search results',
      waitTimeMs: 5000,
    },
  },
  {
    site: 'wikipedia.org',
    displayName: 'Wikipedia',
    searchUrl: 'https://en.wikipedia.org/w/index.php?search={query}',
    preferredStrategy: 'xpath-schema',
    hints: {
      searchInputHint: 'search input',
      resultsContainerHint: 'search results',
      waitTimeMs: 3000,
    },
  },
  {
    site: 'github.com',
    displayName: 'GitHub',
    searchUrl: 'https://github.com/search?q={query}&type=repositories',
    preferredStrategy: 'xpath-schema',
    hints: {
      searchInputHint: 'search input',
      resultsContainerHint: 'repository search results',
      waitTimeMs: 4000,
    },
  },
  {
    site: 'homedepot.com',
    displayName: 'Home Depot',
    searchUrl: 'https://www.homedepot.com/s/{query}',
    preferredStrategy: 'xpath-schema',
    hints: {
      searchInputHint: 'search input',
      resultsContainerHint: 'product results grid',
      waitTimeMs: 5000,
    },
  },
  {
    site: 'macys.com',
    displayName: "Macy's",
    searchUrl: 'https://www.macys.com/shop/featured/{query}',
    preferredStrategy: 'xpath-schema',
    hints: {
      searchInputHint: 'search input',
      resultsContainerHint: 'product grid',
      waitTimeMs: 5000,
    },
  },
  {
    site: 'duckduckgo.com',
    displayName: 'DuckDuckGo',
    searchUrl: 'https://duckduckgo.com/?q={query}',
    preferredStrategy: 'xpath-schema',
    hints: {
      searchInputHint: 'search input',
      resultsContainerHint: 'search results',
      waitTimeMs: 3000,
    },
  },
];

/**
 * Get site configuration by domain
 */
export function getSiteConfig(site: string): SiteConfig | null {
  const normalized = site.toLowerCase().replace(/^www\./, '');
  return SITE_CONFIGS.find(c => normalized.includes(c.site)) || null;
}

/**
 * Get search URL for a site and query
 */
export function getSearchUrl(site: string, query: string): string {
  const config = getSiteConfig(site);
  if (config) {
    return config.searchUrl.replace('{query}', encodeURIComponent(query));
  }
  // Default: append query parameter
  const normalizedSite = site.includes('://') ? site : `https://${site}`;
  const url = new URL(normalizedSite);
  url.pathname = '/search';
  url.searchParams.set('q', query);
  return url.toString();
}

/**
 * XPath + Schema-based search strategy
 * Uses accessibility tree analysis and SchemaBasedExtractorTool for extraction
 */
export class XPathSchemaStrategy implements SearchStrategy {
  name: SearchStrategyType = 'xpath-schema';
  description = 'XPath-based element identification with Schema extraction';
  priority = 1;

  private schemaExtractor = new SchemaBasedExtractorTool();

  async generatePattern(
    options: PatternGenerationOptions,
    adapter: CDPSessionAdapter,
    ctx?: LLMContext
  ): Promise<PatternGenerationResult> {
    logger.info('Generating XPath pattern', { site: options.site });

    try {
      // Get the search URL for this site
      const searchUrl = getSearchUrl(options.site, options.sampleQuery);
      logger.debug('Search URL computed', { searchUrl });

      // Navigate to search URL directly (faster than form fill for pattern generation)
      const pageAgent = adapter.pageAgent();
      await pageAgent.invoke<{ frameId: string }>('navigate', { url: searchUrl });

      // Wait for page load
      const config = getSiteConfig(options.site);
      const waitTime = config?.hints?.waitTimeMs || 3000;
      await this.wait(waitTime);

      // Capture accessibility snapshot to analyze results structure
      const snapshot = await captureHybridSnapshotUniversal(adapter, {
        pierceShadow: true,
      });

      // Find search input XPath from snapshot
      const searchInputXPath = await this.findSearchInput(snapshot, adapter);
      logger.debug('Found search input', { searchInputXPath: searchInputXPath || 'not found' });

      // Build results extraction schema based on site
      const resultsSchema = this.buildResultsSchema(options.site);

      // Build extraction instruction
      const extractionInstruction = this.buildExtractionInstruction(options.site);

      const xpathPattern: XPathPattern = {
        searchInputXPath: searchInputXPath || "//input[@type='search' or @type='text']",
        resultsSchema,
        extractionInstruction,
      };

      const pattern: Omit<SearchPattern, 'id' | 'createdAt' | 'lastUsedAt' | 'successCount' | 'failureCount' | 'schemaVersion'> = {
        site: options.site,
        version: 1,
        strategy: 'xpath-schema',
        xpathPattern,
        sampleQuery: options.sampleQuery,
      };

      return {
        success: true,
        pattern: {
          ...pattern,
          id: '', // Will be set by cache
          createdAt: '',
          lastUsedAt: '',
          successCount: 0,
          failureCount: 0,
          schemaVersion: PATTERN_SCHEMA_VERSION,
        },
      };
    } catch (error) {
      logger.error('Failed to generate pattern:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async executePattern(
    options: PatternExecutionOptions,
    adapter: CDPSessionAdapter,
    ctx?: LLMContext
  ): Promise<PatternExecutionResult> {
    const { pattern, query, maxResults } = options;
    logger.info('Executing XPath pattern', { query, site: pattern.site });

    const startTime = Date.now();

    try {
      const xpathPattern = pattern.xpathPattern;

      if (!xpathPattern) {
        return {
          success: false,
          results: [],
          error: 'Pattern missing XPath configuration',
        };
      }

      // Navigate to search URL
      const searchUrl = getSearchUrl(pattern.site, query);
      logger.debug('Navigating to search URL', { searchUrl });

      const pageAgent = adapter.pageAgent();
      await pageAgent.invoke<{ frameId: string }>('navigate', { url: searchUrl });

      // Wait for results to load
      const config = getSiteConfig(pattern.site);
      const waitTime = config?.hints?.waitTimeMs || 3000;
      await this.wait(waitTime);

      // ============================================
      // FAST PATH: Try cached selector first
      // ============================================
      if (xpathPattern.cachedSelector) {
        logger.debug('Attempting cached selector execution (fast path)');
        try {
          const cachedResults = await this.executeCachedSelectorWithDedup(
            xpathPattern.cachedSelector,
            maxResults,
            adapter
          );

          if (cachedResults.length > 0) {
            const duration = Date.now() - startTime;
            logger.info('Extracted results via cached selector', {
              resultCount: cachedResults.length,
              durationMs: duration,
            });
            return {
              success: true,
              results: cachedResults,
            };
          }
          logger.debug('Cached selector returned no results, falling back to LLM extraction');
        } catch (error) {
          logger.warn('Cached selector failed, falling back to LLM extraction', { error });
        }
      }

      // ============================================
      // SLOW PATH: Use LLM-based extraction
      // ============================================
      logger.debug('Using LLM-based extraction (slow path)');

      // Extract results using SchemaBasedExtractorTool
      const extractionResult = await this.schemaExtractor.execute(
        {
          schema: xpathPattern.resultsSchema,
          instruction: xpathPattern.extractionInstruction.replace('{maxResults}', String(maxResults)),
          reasoning: `Extracting search results for query: ${query}`,
        },
        ctx
      );

      if (!extractionResult.success) {
        return {
          success: false,
          results: [],
          error: extractionResult.error || 'Extraction failed',
        };
      }

      // Transform extracted data to SearchResult format and deduplicate
      const results = this.deduplicateResults(
        this.transformResults(extractionResult.data, maxResults)
      );

      const duration = Date.now() - startTime;
      logger.info('Extracted results via LLM', {
        resultCount: results.length,
        durationMs: duration,
      });

      // ============================================
      // Generate cached selector for future use
      // ============================================
      // Skip if already generating or already has selector
      if (!xpathPattern.cachedSelector && results.length > 0 && ctx) {
        const siteKey = pattern.site.toLowerCase();

        // Race condition protection: skip if already generating for this site
        if (selectorGenerationInProgress.has(siteKey)) {
          logger.debug('Selector generation already in progress for site', { site: siteKey });
        } else {
          selectorGenerationInProgress.add(siteKey);
          logger.debug('Generating cached selector (blocking)', { site: siteKey });

          try {
            // Generate selector synchronously - ensures it's ready for next query
            const cachedSelector = await this.generateCachedSelector(pattern.site, results, adapter, ctx);
            if (cachedSelector) {
              await this.updatePatternWithSelector(pattern.site, cachedSelector);
              logger.info('Cached selector ready for future use', { site: siteKey });
            }
          } catch (err) {
            logger.warn('Failed to generate cached selector', { error: err });
          } finally {
            selectorGenerationInProgress.delete(siteKey);
          }
        }
      }

      return {
        success: true,
        results,
      };
    } catch (error) {
      logger.error('Failed to execute pattern', { error });
      return {
        success: false,
        results: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Find search input XPath from accessibility snapshot
   */
  private async findSearchInput(
    snapshot: HybridSnapshot,
    adapter: CDPSessionAdapter
  ): Promise<string | null> {
    // Look for searchbox or textbox role with search-related name
    const treeText = snapshot.combinedTree;
    const lines = treeText.split('\n');

    for (const line of lines) {
      // Look for searchbox role
      if (line.includes('searchbox:') || line.includes('combobox:')) {
        const match = line.match(/\[(\d+-\d+)\]/);
        if (match) {
          const encodedId = match[1] as EncodedId;
          const xpath = snapshot.combinedXpathMap[encodedId];
          if (xpath) {
            return xpath;
          }
        }
      }
      // Look for textbox with search-related name
      if (line.includes('textbox:') &&
          (line.toLowerCase().includes('search') || line.toLowerCase().includes('query'))) {
        const match = line.match(/\[(\d+-\d+)\]/);
        if (match) {
          const encodedId = match[1] as EncodedId;
          const xpath = snapshot.combinedXpathMap[encodedId];
          if (xpath) {
            return xpath;
          }
        }
      }
    }

    return null;
  }

  /**
   * Build extraction schema for results
   */
  private buildResultsSchema(site: string): SchemaDefinition {
    // Base properties for all search results
    const itemProperties: Record<string, { type: string; description: string; format?: string }> = {
      title: { type: 'string', description: 'Title of the search result' },
      url: { type: 'string', format: 'url', description: 'URL of the search result' },
      snippet: { type: 'string', description: 'Description or snippet text' },
      position: { type: 'number', description: 'Position in search results (1-indexed)' },
    };

    // Add site-specific fields
    const config = getSiteConfig(site);
    if (config?.site === 'amazon.com') {
      // Amazon-specific fields
      itemProperties.price = { type: 'string', description: 'Product price' };
      itemProperties.rating = { type: 'string', description: 'Product rating' };
      itemProperties.reviewCount = { type: 'string', description: 'Number of reviews' };
    } else if (config?.site === 'github.com') {
      // GitHub-specific fields
      itemProperties.stars = { type: 'number', description: 'Star count' };
      itemProperties.language = { type: 'string', description: 'Primary programming language' };
      itemProperties.description = { type: 'string', description: 'Repository description' };
    }

    return {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: itemProperties,
            required: ['title', 'url'],
          },
        },
      },
      required: ['results'],
    };
  }

  /**
   * Build extraction instruction
   */
  private buildExtractionInstruction(site: string): string {
    const config = getSiteConfig(site);

    let instruction = `Extract the top {maxResults} search results from this page. `;
    instruction += `For each result, extract the title, URL, snippet/description, and position (1-indexed). `;

    if (config?.site === 'amazon.com') {
      instruction += `Also extract price, rating, and review count for each product. `;
    } else if (config?.site === 'github.com') {
      instruction += `Also extract star count, primary language, and repository description. `;
    }

    instruction += `Skip any ads or sponsored results. Focus on organic search results only.`;

    return instruction;
  }

  /**
   * Transform extracted data to SearchResult array
   */
  private transformResults(data: any, maxResults: number): SearchResult[] {
    if (!data || !data.results || !Array.isArray(data.results)) {
      return [];
    }

    const results: SearchResult[] = data.results
      .slice(0, maxResults)
      .map((item: any, index: number) => {
        const result: SearchResult = {
          title: item.title || '',
          url: item.url || '',
          snippet: item.snippet || item.description || '',
          position: item.position || index + 1,
        };

        // Add any additional fields
        const knownFields = ['title', 'url', 'snippet', 'description', 'position'];
        const additionalFields: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(item)) {
          if (!knownFields.includes(key) && value !== undefined) {
            additionalFields[key] = value;
          }
        }
        if (Object.keys(additionalFields).length > 0) {
          result.additionalFields = additionalFields;
        }

        return result;
      });

    return results;
  }

  /**
   * Deduplicate results by URL (case-insensitive)
   * Keeps first occurrence of each unique URL
   */
  private deduplicateResults(results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    const deduplicated: SearchResult[] = [];

    for (const result of results) {
      const normalizedUrl = result.url.toLowerCase().trim();
      if (!seen.has(normalizedUrl)) {
        seen.add(normalizedUrl);
        deduplicated.push(result);
      }
    }

    if (deduplicated.length < results.length) {
      logger.warn('Deduplicated search results', {
        original: results.length,
        unique: deduplicated.length,
        duplicatesRemoved: results.length - deduplicated.length,
      });
    }

    return deduplicated;
  }

  /**
   * Normalize URL for comparison (lowercase, remove tracking params)
   */
  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove common tracking parameters
      parsed.searchParams.delete('utm_source');
      parsed.searchParams.delete('utm_medium');
      parsed.searchParams.delete('utm_campaign');
      parsed.searchParams.delete('ref');
      return (parsed.origin + parsed.pathname).toLowerCase();
    } catch {
      return url.toLowerCase().trim();
    }
  }

  /**
   * Score a selector's output against ground truth results
   * Used by agent loop to evaluate selector quality
   */
  private scoreSelector(
    actual: SearchResult[],
    expected: SearchResult[]
  ): SelectorScore {
    // Build URL sets for comparison
    const actualUrls = new Set(actual.map(r => this.normalizeUrl(r.url)));
    const expectedUrls = expected.map(r => this.normalizeUrl(r.url));

    // Coverage: how many ground truth results did we find?
    const matches = expectedUrls.filter(u => actualUrls.has(u)).length;
    const coverage = expected.length > 0 ? matches / expected.length : 0;

    // Uniqueness: are there duplicates in actual results?
    const uniqueRate = actual.length > 0 ? actualUrls.size / actual.length : 0;

    // Scalability: did we find at least as many as ground truth?
    const scalable = actual.length >= expected.length;

    // Valid if: 80% coverage AND >= 95% unique (allow minor duplicates)
    const valid = coverage >= 0.8 && uniqueRate >= 0.95;

    // Perfect if valid AND scalable
    const perfect = valid && scalable;

    // Generate feedback for LLM
    const feedback = this.generateSelectorFeedback(actual, expected, coverage, uniqueRate);

    return {
      coverage,
      uniqueRate,
      totalFound: actual.length,
      scalable,
      valid,
      perfect,
      feedback,
    };
  }

  /**
   * Generate detailed feedback for LLM to improve selector
   */
  private generateSelectorFeedback(
    actual: SearchResult[],
    expected: SearchResult[],
    coverage: number,
    uniqueRate: number
  ): string {
    const issues: string[] = [];

    if (actual.length === 0) {
      return 'Selector returned ZERO results. Check that your CSS selector matches elements on the page. Look for product cards, list items, or article elements.';
    }

    if (uniqueRate < 1.0) {
      const duplicates = actual.length - Math.round(actual.length * uniqueRate);
      issues.push(`Found ${duplicates} DUPLICATE URLs. Your selector is matching the same element multiple times. Use querySelectorAll() once on the container, not multiple querySelector() calls.`);
    }

    if (coverage < 0.8) {
      const missing = expected.length - Math.round(expected.length * coverage);
      issues.push(`Missing ${missing}/${expected.length} expected results. Your selector is TOO RESTRICTIVE. Use broader CSS selectors like [class*="product"] or parent container selectors.`);

      // Show which URLs were missed
      const actualUrls = new Set(actual.map(r => this.normalizeUrl(r.url)));
      const missedResults = expected.filter(r => !actualUrls.has(this.normalizeUrl(r.url)));
      if (missedResults.length > 0 && missedResults.length <= 3) {
        issues.push(`Missed products: ${missedResults.map(r => r.title.substring(0, 30)).join(', ')}`);
      }
    }

    if (actual.length < expected.length) {
      issues.push(`Found only ${actual.length} results but expected at least ${expected.length}. The selector should capture ALL products in the grid/list.`);
    }

    if (issues.length === 0) {
      return 'Selector looks good!';
    }

    return issues.join('\n');
  }

  /**
   * Wait for specified milliseconds
   */
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute cached JavaScript selector via Runtime.evaluate
   * Returns extracted results or throws on failure
   */
  private async executeCachedSelector(
    selectorScript: string,
    maxResults: number,
    adapter: CDPSessionAdapter
  ): Promise<SearchResult[]> {
    const runtimeAgent = adapter.runtimeAgent();

    const result = await runtimeAgent.invoke<{
      result?: { value?: unknown; type?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>('evaluate', {
      expression: selectorScript,
      returnByValue: true,
      awaitPromise: false,
    });

    if (result.exceptionDetails) {
      const errorMsg = result.exceptionDetails.exception?.description ||
                       result.exceptionDetails.text ||
                       'Unknown error';
      throw new Error(`Selector execution failed: ${errorMsg}`);
    }

    const data = result.result?.value;
    logger.debug('Selector execution raw result', {
      resultType: result.result?.type,
      isArray: Array.isArray(data),
      dataLength: Array.isArray(data) ? data.length : 0,
      firstItem: Array.isArray(data) && data.length > 0 ? JSON.stringify(data[0]).substring(0, 200) : null,
    });

    if (!data || !Array.isArray(data)) {
      throw new Error('Selector did not return array');
    }

    // Transform and validate results
    const transformed = this.transformResults({ results: data }, maxResults);

    // Deduplicate by default, but allow skipping for scoring purposes
    // (scoring needs raw results to detect duplicate issues)
    return transformed;
  }

  /**
   * Execute cached selector and deduplicate results
   * Use this for actual extraction (fast path), not for scoring
   */
  private async executeCachedSelectorWithDedup(
    selector: string,
    maxResults: number,
    adapter: CDPSessionAdapter
  ): Promise<SearchResult[]> {
    const results = await this.executeCachedSelector(selector, maxResults, adapter);
    return this.deduplicateResults(results);
  }

  /**
   * Generate cached selector for a site using agent-based approach
   * Iteratively tests and refines selectors until quality threshold is met
   * Returns null if generation fails or LLM context not available
   */
  private async generateCachedSelector(
    site: string,
    extractedResults: SearchResult[],
    adapter: CDPSessionAdapter,
    ctx?: LLMContext
  ): Promise<string | null> {
    // Check if LLM context is available (need provider and at least one model)
    if (!ctx?.provider || (!ctx.miniModel && !ctx.model)) {
      logger.debug('No LLM context available for selector generation', { site });
      return null;
    }

    // Capture accessibility tree snippet for LLM context
    let treeSnippet = '';
    try {
      const snapshot = await captureHybridSnapshotUniversal(adapter, { pierceShadow: true });
      const fullTree = snapshot.combinedTree || '';
      // Truncate to ~5000 chars to stay within token limits
      treeSnippet = fullTree.substring(0, 5000);
    } catch (error) {
      logger.warn('Failed to capture tree snippet for selector generation', { error });
      return null;
    }

    // Agent loop: iteratively test and refine selectors
    const MAX_ITERATIONS = 5;
    const MAX_CONSECUTIVE_FAILURES = 3;
    let lastFeedback = '';
    let bestSelector: string | null = null;
    let bestScore = 0;
    let consecutiveFailures = 0;

    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
      // Early exit if too many consecutive failures
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        logger.warn('Exiting early due to consecutive failures', {
          site,
          consecutiveFailures,
          iteration,
        });
        break;
      }

      logger.debug('Selector generation agent iteration', {
        site,
        iteration,
        maxIterations: MAX_ITERATIONS,
        hasPreviousFeedback: !!lastFeedback,
      });

      // Generate candidate selector via LLM
      const candidateScript = await this.buildSelectorScriptWithLLM(
        site,
        extractedResults,
        treeSnippet,
        ctx,
        lastFeedback
      );

      if (!candidateScript) {
        lastFeedback = 'LLM failed to generate valid JavaScript code. Ensure code is wrapped in (function() { ... })() and returns an array.';
        logger.warn('Selector generation failed', { iteration, error: lastFeedback });
        consecutiveFailures++;
        continue;
      }

      // Execute candidate and score against ground truth
      try {
        // Test with more results than ground truth to verify selector can scale
        const testMaxResults = Math.max(extractedResults.length * 2, 20);
        const testResults = await this.executeCachedSelector(
          candidateScript,
          testMaxResults,
          adapter
        );

        // Filter to valid results (has title and url)
        const validResults = testResults.filter(r =>
          r.title && r.title.trim().length > 0 &&
          r.url && r.url.trim().length > 0
        );

        // Score the selector
        const score = this.scoreSelector(validResults, extractedResults);

        logger.debug('Selector iteration scored', {
          iteration,
          totalFound: score.totalFound,
          coverage: Math.round(score.coverage * 100) + '%',
          uniqueRate: Math.round(score.uniqueRate * 100) + '%',
          valid: score.valid,
          perfect: score.perfect,
        });

        // Track best selector found
        const totalScore = score.coverage * 0.5 + score.uniqueRate * 0.5;
        if (score.valid && totalScore > bestScore) {
          bestSelector = candidateScript;
          bestScore = totalScore;
          logger.debug('New best selector found', { iteration, score: totalScore });
        }

        // If perfect, return immediately
        if (score.perfect) {
          logger.info('Generated perfect selector', {
            site,
            iteration,
            resultCount: score.totalFound,
            coverage: Math.round(score.coverage * 100) + '%',
          });
          return candidateScript;
        }

        // Set feedback for next iteration
        lastFeedback = score.feedback;

        // If valid but not perfect, we have a good fallback
        if (score.valid) {
          logger.debug('Valid but not perfect selector', {
            iteration,
            coverage: Math.round(score.coverage * 100) + '%',
            continuing: iteration < MAX_ITERATIONS,
          });
        }

        // Reset consecutive failures on successful execution
        consecutiveFailures = 0;
      } catch (error) {
        lastFeedback = `Selector execution error: ${error instanceof Error ? error.message : String(error)}. Check for syntax errors or runtime exceptions.`;
        logger.warn('Selector execution failed', { iteration, error: lastFeedback });
        consecutiveFailures++;
        continue;
      }
    }

    // Return best selector found, or null if none met minimum threshold
    if (bestSelector) {
      logger.info('Returning best selector found (not perfect)', {
        site,
        score: bestScore,
      });
      return bestSelector;
    }

    logger.warn('All selector generation iterations failed', { site, iterations: MAX_ITERATIONS });
    return null;
  }

  /**
   * Generate JavaScript selector using LLM
   * Returns executable JavaScript code or null on failure
   */
  private async buildSelectorScriptWithLLM(
    site: string,
    extractedResults: SearchResult[],
    treeSnippet: string,
    ctx: LLMContext,
    previousError?: string
  ): Promise<string | null> {
    const config = getSiteConfig(site);
    const siteDisplayName = config?.displayName || site;

    const systemPrompt = `You are a JavaScript code generation expert specializing in web scraping.
Your task is to generate a JavaScript selector function that extracts ORGANIC search results from a search engine page.

CRITICAL RULES:
1. Generate ONLY executable JavaScript code that returns an array of result objects
2. Each result object must have: { title, url, snippet, position }
3. Use document.querySelector/querySelectorAll for DOM traversal
4. Return immediately executable code (no imports, no async, no external dependencies)
5. NEVER hallucinate - base selectors on the actual DOM structure provided
6. Code must be wrapped in an IIFE: (function() { ... })()
7. Return an array, even if empty
8. Use .trim() for all text extraction
9. Handle missing elements gracefully with optional chaining (?.)
10. ENSURE UNIQUE RESULTS - never select the same element multiple times
11. Use querySelectorAll ONCE to get all items, then iterate - do NOT use querySelector in a loop
12. Each result MUST have a DIFFERENT URL - deduplicate before returning
13. Use STRUCTURAL selectors (CSS classes, data attributes) NOT query-specific patterns
14. The selector must work for ANY search query on this site, not just the example
15. Find ALL results in the product grid/list, not just a subset

WHAT ARE ORGANIC SEARCH RESULTS:
- They link to EXTERNAL websites (not google.com, not bing.com, etc.)
- They have a title (clickable heading), URL displayed, and a text snippet/description
- They are the main content of the page, not navigation or filters
- Look for the URL pattern in the expected results to understand what external domains look like

WHAT TO SKIP:
- Navigation links (Home, Images, Videos, News tabs)
- "AI Mode", "All", "Shopping" filter buttons
- Google apps menu
- Ads/sponsored content (often marked with "Ad" or "Sponsored")
- Related searches and "People also ask"
- Site header/footer elements

OUTPUT FORMAT:
Return ONLY the JavaScript code wrapped in markdown code blocks:
\`\`\`javascript
(function() {
  // Your extraction code here
  return results;
})()
\`\`\``;

    // Sample of expected results (first 3)
    const exampleResults = JSON.stringify(extractedResults.slice(0, 3), null, 2);

    let userPrompt = `SITE: ${siteDisplayName} (${site})

ACCESSIBILITY TREE SNIPPET (showing DOM structure):
\`\`\`
${treeSnippet}
\`\`\`

EXAMPLE OF EXPECTED RESULTS (from successful LLM extraction - this is what your code should produce):
\`\`\`json
${exampleResults}
\`\`\`

TASK: Generate JavaScript code that extracts ORGANIC search results from the DOM.
IMPORTANT: Only extract results that link to EXTERNAL websites (look at the example URLs above - they go to sites like w3schools.com, react.dev, freecodecamp.org, NOT google.com)

- Study the example results to understand the URL pattern of organic results
- Use CSS selectors that target links to EXTERNAL domains
- Return array of objects with: title, url, snippet, position (1-indexed)
- Skip ALL google.com links (navigation, filters, pagination, etc.)
- Skip ads, sponsored content, "People also ask", and related searches
- Limit to 20 results maximum`;

    // Add error feedback for retries
    if (previousError) {
      userPrompt += `

PREVIOUS ATTEMPT FAILED WITH ERROR: ${previousError}

Please fix the code to address this error. Common issues:
- Incorrect CSS selectors (check the accessibility tree for correct element structure)
- Elements not present in DOM (use optional chaining)
- Syntax errors in JavaScript
- Not returning an array`;
    }

    try {
      // Use miniModel if available, fall back to main model
      const model = ctx.miniModel || ctx.model;
      const llmResponse = await callLLMWithTracing(
        {
          provider: ctx.provider,
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          systemPrompt,
          temperature: 0.1,
          options: { retryConfig: { maxRetries: 2, baseDelayMs: 1000 } },
        },
        {
          toolName: 'search_strategy',
          operationName: 'generate_selector',
          context: `LLM selector generation for ${site}`,
          additionalMetadata: {
            site,
            resultsCount: extractedResults.length,
            hasError: !!previousError,
          },
        }
      );

      const responseText = llmResponse.text || '';
      const code = this.extractJavaScriptFromResponse(responseText);
      logger.debug('LLM generated selector code', {
        codeLength: code?.length || 0,
        codePreview: code?.substring(0, 300),
      });
      return code;
    } catch (error) {
      logger.error('LLM selector generation call failed', { error });
      return null;
    }
  }

  /**
   * Extract JavaScript code from LLM response
   * Handles markdown code blocks and basic validation
   */
  private extractJavaScriptFromResponse(response: string): string | null {
    // Try to extract from markdown code blocks
    const codeBlockMatch = response.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
    let code = codeBlockMatch ? codeBlockMatch[1].trim() : response.trim();

    // Basic validation
    if (!code || code.length < 30) {
      logger.warn('Extracted code too short', { codeLength: code?.length || 0 });
      return null;
    }

    // Must contain function or return
    if (!code.includes('function') && !code.includes('return')) {
      logger.warn('Code does not contain function or return statement');
      return null;
    }

    // Ensure code is wrapped in IIFE and invoked exactly once
    code = code.trim();

    // Check if already a properly formed IIFE: (function() { ... })()
    const isProperIIFE = /^\(function\s*\([^)]*\)\s*\{[\s\S]*\}\s*\)\s*\(\s*\)$/.test(code);

    if (!isProperIIFE) {
      // Remove any trailing () that might cause double-invocation
      code = code.replace(/\(\s*\)\s*$/, '').trim();

      // Check if it's a function expression without invocation
      const isFunctionExpr = /^\(function\s*\([^)]*\)\s*\{[\s\S]*\}\s*\)$/.test(code);
      if (isFunctionExpr) {
        // Just add the invocation
        code = code + '()';
      } else if (code.startsWith('function')) {
        // Named or anonymous function declaration - wrap and invoke
        code = `(${code})()`;
      } else {
        // Plain code block - wrap in IIFE
        code = `(function() {\n${code}\n})()`;
      }
    }

    return code;
  }

  /**
   * Update pattern in cache with cached selector
   */
  private async updatePatternWithSelector(
    site: string,
    cachedSelector: string
  ): Promise<void> {
    try {
      const { SearchPatternCache } = await import('./SearchPatternCache.js');
      const cache = SearchPatternCache.getInstance();
      // Look up pattern by site to get the real ID (pattern.id is empty during creation)
      const pattern = await cache.getPattern(site);
      if (!pattern) {
        logger.warn(`Pattern not found for site ${site}`);
        return;
      }
      await cache.updatePatternSelector(pattern.id, cachedSelector);
      logger.info(`Updated pattern for ${site} with cached selector`);
    } catch (error) {
      logger.warn('Failed to update pattern with cached selector:', error);
    }
  }
}

// ============================================================================
// ALTERNATIVE STRATEGIES - More resilient than CSS selectors
// ============================================================================

/**
 * Semantic XPath Strategy
 * Uses ARIA roles and text content instead of CSS classes.
 * More resilient because roles are stable for accessibility compliance.
 */
export class SemanticXPathStrategy implements SearchStrategy {
  name: SearchStrategyType = 'semantic-xpath';
  description = 'XPath with ARIA roles and text content - survives CSS class changes';
  priority = 2;

  async generatePattern(
    options: PatternGenerationOptions,
    adapter: CDPSessionAdapter,
    ctx?: LLMContext
  ): Promise<PatternGenerationResult> {
    logger.info('Generating Semantic XPath pattern', { site: options.site });

    try {
      // Navigate to search page
      const searchUrl = getSearchUrl(options.site, options.sampleQuery);
      const pageAgent = adapter.pageAgent();
      await pageAgent.invoke<{ frameId: string }>('navigate', { url: searchUrl });

      // Wait for results to load
      const config = getSiteConfig(options.site);
      const waitTime = config?.hints?.waitTimeMs || 3000;
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Capture accessibility tree to analyze result structure
      const snapshot = await captureHybridSnapshotUniversal(adapter, {
        pierceShadow: true,
      });

      // Build semantic XPath pattern by analyzing the page
      const semanticPattern = this.buildSemanticXPathPattern(options.site, snapshot);

      // Create the full pattern
      const pattern: SearchPattern = {
        id: '',
        site: options.site,
        version: 1,
        strategy: 'semantic-xpath',
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        successCount: 0,
        failureCount: 0,
        xpathPattern: {
          searchInputXPath: '',
          resultsSchema: { type: 'object', properties: {} },
          extractionInstruction: '',
          semanticXPath: semanticPattern,
        },
        sampleQuery: options.sampleQuery,
        schemaVersion: PATTERN_SCHEMA_VERSION,
      };

      return { success: true, pattern };
    } catch (error) {
      logger.error('Failed to generate Semantic XPath pattern', { error });
      return { success: false, error: String(error) };
    }
  }

  async executePattern(
    options: PatternExecutionOptions,
    adapter: CDPSessionAdapter,
    _ctx?: LLMContext
  ): Promise<PatternExecutionResult> {
    const { pattern, query, maxResults } = options;
    const semanticPattern = pattern.xpathPattern?.semanticXPath;

    if (!semanticPattern) {
      return { success: false, results: [], error: 'No semantic XPath pattern available' };
    }

    try {
      // Navigate to search URL
      const searchUrl = getSearchUrl(pattern.site, query);
      const pageAgent = adapter.pageAgent();
      await pageAgent.invoke<{ frameId: string }>('navigate', { url: searchUrl });

      // Wait for results
      const config = getSiteConfig(pattern.site);
      const waitTime = config?.hints?.waitTimeMs || 3000;
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Execute semantic XPath via Runtime.evaluate
      const results = await this.executeSemanticXPath(semanticPattern, pattern.site, maxResults, adapter);

      return { success: true, results };
    } catch (error) {
      logger.error('Semantic XPath execution failed', { error });
      return { success: false, results: [], error: String(error) };
    }
  }

  private buildSemanticXPathPattern(site: string, snapshot: HybridSnapshot): SemanticXPathPattern {
    // Build site-specific URL exclusions
    const siteExclusions = this.getSiteUrlExclusions(site);

    // Default semantic XPath that finds external links not in navigation
    const roleBasedXPath = `//a[@href][not(ancestor::nav)][not(ancestor::header)][not(ancestor::footer)][string-length(normalize-space(.)) >= 5]`;

    return {
      roleBasedXPath,
      fieldMappings: {
        title: 'normalize-space(.)',
        url: '@href',
        snippet: 'normalize-space(following-sibling::*[1])',
      },
      urlFilter: 'external',
      navigationExclusions: siteExclusions,
    };
  }

  private getSiteUrlExclusions(site: string): string[] {
    // Common patterns to exclude for different sites
    const exclusions: Record<string, string[]> = {
      'google.com': ['google.com', 'accounts.google', 'support.google', 'policies.google'],
      'bing.com': ['bing.com', 'microsoft.com/account', 'go.microsoft'],
      'amazon.com': ['amazon.com/gp/help', 'amazon.com/hz/contact', 'amazon.com/ap/signin'],
      'github.com': ['github.com/login', 'github.com/signup', 'github.com/settings'],
    };

    const normalized = site.toLowerCase().replace(/^www\./, '');
    for (const [key, value] of Object.entries(exclusions)) {
      if (normalized.includes(key)) {
        return value;
      }
    }
    return [site]; // Exclude the site itself by default
  }

  private async executeSemanticXPath(
    pattern: SemanticXPathPattern,
    site: string,
    maxResults: number,
    adapter: CDPSessionAdapter
  ): Promise<SearchResult[]> {
    const runtimeAgent = adapter.runtimeAgent();

    // Build exclusion predicates for XPath
    const exclusionPredicates = pattern.navigationExclusions
      ?.map(excl => `not(contains(@href, '${excl}'))`)
      .join(' and ') || 'true()';

    const script = `
    (function() {
      const results = [];
      const seenUrls = new Set();
      const siteHost = '${site.toLowerCase().replace(/^www\\./, '')}';

      // BING COPILOT SEARCH: Extract from cite elements (URLs not in hrefs)
      if (siteHost.includes('bing')) {
        document.querySelectorAll('cite').forEach(cite => {
          if (results.length >= ${maxResults}) return;

          const citeText = cite.textContent || '';
          let url = citeText.replace(/ › /g, '/').trim();
          if (!url.startsWith('http')) url = 'https://' + url;

          if (url.includes('bing.com') || url.includes('microsoft.com')) return;
          if (seenUrls.has(url.toLowerCase())) return;

          let container = cite.parentElement;
          for (let i = 0; i < 8 && container; i++) {
            if (container.querySelector('h2, h3, [class*="title"]')) break;
            container = container.parentElement;
          }

          if (container) {
            const titleEl = container.querySelector('h2, h3, [class*="title"]');
            const title = titleEl?.textContent?.trim() || '';

            if (title.length >= 5) {
              // Try multiple snippet extraction strategies for Bing
              let snippet = '';

              // Strategy 1: Known snippet selectors
              const snippetSelectors = [
                'p:not(:has(cite))',
                '[class*="snippet"]',
                '[class*="caption"]',
                '.b_lineclamp2',
                '.b_algoSlug'
              ];

              for (const sel of snippetSelectors) {
                const el = container.querySelector(sel);
                if (el) {
                  const text = el.textContent?.trim() || '';
                  if (text.length > 20 && !text.includes(' › ')) {
                    snippet = text.substring(0, 200);
                    break;
                  }
                }
              }

              // Strategy 2: Get container text minus title and URL
              if (!snippet) {
                const containerText = container.textContent?.trim() || '';
                let cleaned = containerText
                  .replace(title, '')
                  .replace(/https?:\\/\\/[^\\s]+/g, '')
                  .replace(/[a-z]+\\.[a-z]+\\s*›[^\\n]*/gi, '')
                  .replace(/\\s+/g, ' ')
                  .trim();
                if (cleaned.length > 30) {
                  snippet = cleaned.substring(0, 200);
                }
              }

              seenUrls.add(url.toLowerCase());
              results.push({
                title: title.substring(0, 200),
                url,
                snippet,
                position: results.length + 1
              });
            }
          }
        });
        if (results.length > 0) return results;
      }

      // WIKIPEDIA: Extract from .mw-search-result containers (internal URLs)
      if (siteHost.includes('wikipedia')) {
        document.querySelectorAll('.mw-search-result').forEach(result => {
          if (results.length >= ${maxResults}) return;

          const link = result.querySelector('.mw-search-result-heading a');
          const snippetEl = result.querySelector('.searchresult');

          if (link) {
            const url = link.href;
            const title = link.textContent?.trim() || '';

            if (title.length >= 3 && url.includes('/wiki/')) {
              if (seenUrls.has(url.toLowerCase())) return;
              seenUrls.add(url.toLowerCase());

              results.push({
                title: title.substring(0, 200),
                url,
                snippet: snippetEl?.textContent?.trim().substring(0, 200) || '',
                position: results.length + 1
              });
            }
          }
        });
        if (results.length > 0) return results;
      }

      // XPath to find all links with text content
      const xpath = "${pattern.roleBasedXPath}[${exclusionPredicates}]";
      const iterator = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);

      let node;
      let position = 0;

      // Generic title patterns to skip (not actual search results)
      const genericTitles = /^(read more|learn more|see more|view more|more info|continue|click here|here|next|previous|show more|expand|details|info)$/i;

      while ((node = iterator.iterateNext()) && results.length < ${maxResults}) {
        const url = node.href;
        const title = node.textContent?.trim() || '';

        // Skip empty, duplicate, or internal URLs
        if (!url || !title || title.length < 5) continue;
        if (seenUrls.has(url.toLowerCase())) continue;
        // Skip generic "Read more" type links
        if (genericTitles.test(title)) continue;

        // Filter for external URLs only (if urlFilter === 'external')
        ${pattern.urlFilter === 'external' ? `
        try {
          const urlHost = new URL(url).hostname.toLowerCase().replace(/^www\\./, '');
          if (urlHost.includes(siteHost) || siteHost.includes(urlHost)) continue;
        } catch (e) { continue; }
        ` : ''}

        seenUrls.add(url.toLowerCase());
        position++;

        // Find search result container
        let container = node.parentElement;
        for (let i = 0; i < 5 && container; i++) {
          if (container.querySelector('[class*="VwiC3b"]') ||
              container.querySelector('[class*="b_caption"]') ||
              container.querySelector('.searchmatch')) {
            break;
          }
          container = container.parentElement;
        }

        let snippet = '';
        if (container) {
          // Strategy 0: Site-specific known snippet classes
          const siteSelectors = [
            '.VwiC3b', '.lEBKkf', // Google
            '.b_caption p', '.b_algoSlug', // Bing
            '.searchresult', '.searchmatch', // Wikipedia
            '[data-sncf]',
          ];

          for (const sel of siteSelectors) {
            const el = container.querySelector(sel);
            if (el && el !== node && !el.contains(node) && !node.contains(el)) {
              const text = el.textContent?.trim() || '';
              if (text.length > 30 && !text.startsWith('http') && !text.includes(' › ')) {
                snippet = text.slice(0, 200);
                break;
              }
            }
          }

          // Strategy 1: Look for <p> tags with substantial text
          if (!snippet) {
            const ps = container.querySelectorAll('p');
            for (const p of ps) {
              if (p !== node && !p.contains(node) && !node.contains(p)) {
                const text = p.textContent?.trim() || '';
                if (text.length > 30 && !text.startsWith('http') && !text.includes(' › ')) {
                  snippet = text.slice(0, 200);
                  break;
                }
              }
            }
          }

          // Strategy 2: Look for em tags (highlighted terms)
          if (!snippet) {
            const emParent = container.querySelector('em')?.parentElement;
            if (emParent && emParent !== node && !emParent.contains(node)) {
              const text = emParent.textContent?.trim() || '';
              if (text.length > 30) {
                snippet = text.slice(0, 200);
              }
            }
          }

          // Strategy 3: Container text minus title
          if (!snippet) {
            const containerText = container.textContent?.trim() || '';
            if (containerText.length > title.length + 50) {
              let cleaned = containerText;
              const titleIdx = cleaned.indexOf(title);
              if (titleIdx >= 0) {
                cleaned = cleaned.slice(titleIdx + title.length);
              }
              cleaned = cleaned.replace(/https?:\\/\\/[^\\s]+/g, '').replace(/[a-z]+\\.[a-z]+\\s*›[^\\n]*/gi, '');
              cleaned = cleaned.replace(/\\s+/g, ' ').trim();
              if (cleaned.length > 30) {
                snippet = cleaned.slice(0, 200);
              }
            }
          }

          snippet = snippet.replace(/\\s+/g, ' ').trim();
          if (snippet === title || snippet.startsWith('http')) snippet = '';
        }

        results.push({ title, url, snippet, position });
      }

      return results;
    })()
    `;

    const result = await runtimeAgent.invoke<{
      result?: { value?: unknown; type?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>('evaluate', {
      expression: script,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      const errorMsg = result.exceptionDetails.exception?.description ||
                       result.exceptionDetails.text ||
                       'Unknown error';
      throw new Error(`Semantic XPath execution failed: ${errorMsg}`);
    }

    return (result.result?.value as SearchResult[]) || [];
  }
}

/**
 * EncodedId Strategy
 * Parses accessibility tree text directly, matching by role and URL regex.
 * Fastest execution - no DOM traversal, pure string parsing.
 */
export class EncodedIdStrategy implements SearchStrategy {
  name: SearchStrategyType = 'encoded-id';
  description = 'Parse accessibility tree directly - fastest execution, no DOM traversal';
  priority = 3;

  async generatePattern(
    options: PatternGenerationOptions,
    adapter: CDPSessionAdapter,
    _ctx?: LLMContext
  ): Promise<PatternGenerationResult> {
    logger.info('Generating EncodedId pattern', { site: options.site });

    try {
      // Build URL regex to filter external results
      const urlRegex = this.buildUrlRegex(options.site);
      const excludePatterns = this.getExcludeTextPatterns(options.site);

      const encodedIdPattern: EncodedIdPattern = {
        targetRole: 'link',
        urlRegex,
        parentRoleHint: 'main',
        minTextLength: 5,
        excludeTextPatterns: excludePatterns,
      };

      const pattern: SearchPattern = {
        id: '',
        site: options.site,
        version: 1,
        strategy: 'encoded-id',
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        successCount: 0,
        failureCount: 0,
        xpathPattern: {
          searchInputXPath: '',
          resultsSchema: { type: 'object', properties: {} },
          extractionInstruction: '',
          encodedIdPattern,
        },
        sampleQuery: options.sampleQuery,
        schemaVersion: PATTERN_SCHEMA_VERSION,
      };

      return { success: true, pattern };
    } catch (error) {
      logger.error('Failed to generate EncodedId pattern', { error });
      return { success: false, error: String(error) };
    }
  }

  async executePattern(
    options: PatternExecutionOptions,
    adapter: CDPSessionAdapter,
    _ctx?: LLMContext
  ): Promise<PatternExecutionResult> {
    const { pattern, query, maxResults } = options;
    const encodedIdPattern = pattern.xpathPattern?.encodedIdPattern;

    if (!encodedIdPattern) {
      return { success: false, results: [], error: 'No EncodedId pattern available' };
    }

    try {
      // Navigate to search URL
      const searchUrl = getSearchUrl(pattern.site, query);
      const pageAgent = adapter.pageAgent();
      await pageAgent.invoke<{ frameId: string }>('navigate', { url: searchUrl });

      // Wait for results
      const config = getSiteConfig(pattern.site);
      const waitTime = config?.hints?.waitTimeMs || 3000;
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Capture accessibility tree
      const snapshot = await captureHybridSnapshotUniversal(adapter, {
        pierceShadow: true,
      });

      // Parse tree text and extract results
      const results = this.parseAccessibilityTree(
        snapshot.combinedTree,
        snapshot.combinedUrlMap,
        encodedIdPattern,
        maxResults
      );

      return { success: true, results };
    } catch (error) {
      logger.error('EncodedId execution failed', { error });
      return { success: false, results: [], error: String(error) };
    }
  }

  private buildUrlRegex(site: string): string {
    // Regex that matches URLs NOT containing the site domain
    const escapedSite = site.replace(/\./g, '\\.');
    return `^https?://(?!.*${escapedSite})`;
  }

  private getExcludeTextPatterns(site: string): string[] {
    // Common text patterns to exclude (ads, navigation, etc.)
    const patterns = ['Ad', 'Sponsored', 'Promoted', 'Skip to', 'Sign in', 'Log in', 'Menu', 'Navigation'];

    // Site-specific exclusions
    const sitePatterns: Record<string, string[]> = {
      'google.com': ['Images', 'Videos', 'News', 'Shopping', 'Maps', 'More'],
      'amazon.com': ['Add to Cart', 'Buy Now', 'Subscribe'],
      'github.com': ['Sign up', 'Explore', 'Marketplace'],
    };

    const normalized = site.toLowerCase().replace(/^www\./, '');
    for (const [key, value] of Object.entries(sitePatterns)) {
      if (normalized.includes(key)) {
        return [...patterns, ...value];
      }
    }
    return patterns;
  }

  private parseAccessibilityTree(
    treeText: string,
    urlMap: Record<string, string>,
    pattern: EncodedIdPattern,
    maxResults: number
  ): SearchResult[] {
    const results: SearchResult[] = [];
    const seenUrls = new Set<string>();
    const lines = treeText.split('\n');

    // Build regex from pattern
    const urlRegex = new RegExp(pattern.urlRegex, 'i');
    const excludePatterns = pattern.excludeTextPatterns || [];
    const minTextLength = pattern.minTextLength || 5;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      if (results.length >= maxResults) break;

      const line = lines[lineIndex];
      // Parse line format: "[0-123] role: Name Text"
      const match = line.match(/\[(\d+-\d+)\]\s+(\w+):\s*(.+)/);
      if (!match) continue;

      const [, encodedId, role, name] = match;

      // Check role filter
      if (role !== pattern.targetRole) continue;

      // Check text length
      const trimmedName = name.trim();
      if (trimmedName.length < minTextLength) continue;

      // Check exclude patterns
      if (excludePatterns.some(p => trimmedName.includes(p))) continue;

      // Get URL from map
      const url = urlMap[encodedId as EncodedId];
      if (!url) continue;

      // Check URL regex (external filter)
      if (!urlRegex.test(url)) continue;

      // Check for duplicates
      const normalizedUrl = url.toLowerCase();
      if (seenUrls.has(normalizedUrl)) continue;
      seenUrls.add(normalizedUrl);

      // Extract snippet from subsequent lines
      const snippet = this.extractSnippetFromTree(lines, lineIndex, trimmedName);

      results.push({
        title: trimmedName,
        url,
        snippet,
        position: results.length + 1,
      });
    }

    return results;
  }

  /**
   * Extract snippet text from lines following a link in the accessibility tree.
   * Looks for StaticText, text, paragraph roles that contain description text.
   */
  private extractSnippetFromTree(
    lines: string[],
    linkLineIndex: number,
    title: string
  ): string {
    const snippetParts: string[] = [];
    const snippetRoles = ['StaticText', 'text', 'paragraph', 'GenericContainer'];
    const maxLookAhead = 10; // Don't look too far ahead
    const titleLower = title.toLowerCase();

    for (let i = linkLineIndex + 1; i < Math.min(lines.length, linkLineIndex + maxLookAhead); i++) {
      const line = lines[i];

      // Stop if we hit another link (next result)
      if (line.includes('] link:')) break;

      // Parse the line
      const match = line.match(/\[(\d+-\d+)\]\s+(\w+):\s*(.+)/);
      if (!match) continue;

      const [, , role, text] = match;

      // Only collect text from snippet-like roles
      if (!snippetRoles.includes(role)) continue;

      const trimmedText = text.trim();

      // Skip if too short or matches the title
      if (trimmedText.length < 10) continue;
      if (trimmedText.toLowerCase() === titleLower) continue;

      // Skip URL-like text
      if (trimmedText.startsWith('http://') || trimmedText.startsWith('https://')) continue;

      snippetParts.push(trimmedText);

      // Stop after getting enough text
      if (snippetParts.join(' ').length > 150) break;
    }

    return snippetParts.join(' ').substring(0, 300);
  }
}

/**
 * Text/Content Pattern Strategy
 * Matches elements by URL patterns and text filters.
 * URLs are the most stable element of search results.
 */
export class TextPatternStrategy implements SearchStrategy {
  name: SearchStrategyType = 'text-pattern';
  description = 'URL patterns and text filters - most stable element matching';
  priority = 4;

  async generatePattern(
    options: PatternGenerationOptions,
    adapter: CDPSessionAdapter,
    _ctx?: LLMContext
  ): Promise<PatternGenerationResult> {
    logger.info('Generating Text Pattern', { site: options.site });

    try {
      const urlExclusions = this.buildUrlExclusions(options.site);
      const compiledXPath = this.buildTextPatternXPath(urlExclusions);

      const textPattern: TextContentPattern = {
        compiledXPath,
        urlExclusions,
        minTextLength: 5,
        excludeNavigation: true,
        externalUrlIndicators: ['http://', 'https://'],
      };

      const pattern: SearchPattern = {
        id: '',
        site: options.site,
        version: 1,
        strategy: 'text-pattern',
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        successCount: 0,
        failureCount: 0,
        xpathPattern: {
          searchInputXPath: '',
          resultsSchema: { type: 'object', properties: {} },
          extractionInstruction: '',
          textPattern,
        },
        sampleQuery: options.sampleQuery,
        schemaVersion: PATTERN_SCHEMA_VERSION,
      };

      return { success: true, pattern };
    } catch (error) {
      logger.error('Failed to generate Text Pattern', { error });
      return { success: false, error: String(error) };
    }
  }

  async executePattern(
    options: PatternExecutionOptions,
    adapter: CDPSessionAdapter,
    _ctx?: LLMContext
  ): Promise<PatternExecutionResult> {
    const { pattern, query, maxResults } = options;
    const textPattern = pattern.xpathPattern?.textPattern;

    if (!textPattern) {
      return { success: false, results: [], error: 'No text pattern available' };
    }

    try {
      // Navigate to search URL
      const searchUrl = getSearchUrl(pattern.site, query);
      const pageAgent = adapter.pageAgent();
      await pageAgent.invoke<{ frameId: string }>('navigate', { url: searchUrl });

      // Wait for results
      const config = getSiteConfig(pattern.site);
      const waitTime = config?.hints?.waitTimeMs || 3000;
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Execute text pattern XPath
      const results = await this.executeTextPattern(textPattern, pattern.site, maxResults, adapter);

      return { success: true, results };
    } catch (error) {
      logger.error('Text Pattern execution failed', { error });
      return { success: false, results: [], error: String(error) };
    }
  }

  private buildUrlExclusions(site: string): string[] {
    // Base exclusions for the site itself
    const normalized = site.toLowerCase().replace(/^www\./, '');
    const exclusions = [normalized];

    // Common internal URL patterns
    const commonExclusions: Record<string, string[]> = {
      'google.com': ['google.com', 'accounts.google', 'support.google', 'policies.google', 'play.google'],
      'bing.com': ['bing.com', 'microsoft.com', 'msn.com', 'live.com'],
      'amazon.com': ['amazon.com/gp/', 'amazon.com/hz/', 'amazon.com/ap/', 'amazon.com/ref='],
      'github.com': ['github.com/login', 'github.com/signup', 'github.com/settings', 'github.com/features'],
    };

    for (const [key, values] of Object.entries(commonExclusions)) {
      if (normalized.includes(key)) {
        exclusions.push(...values);
        break;
      }
    }

    return [...new Set(exclusions)]; // Deduplicate
  }

  private buildTextPatternXPath(urlExclusions: string[]): string {
    // Build XPath with URL exclusion predicates
    const exclusionPredicates = urlExclusions
      .map(excl => `not(contains(@href, '${excl}'))`)
      .join(' and ');

    return `//a[@href][${exclusionPredicates}][not(ancestor::nav)][not(ancestor::header)][not(ancestor::footer)][string-length(normalize-space(.)) >= 5]`;
  }

  private async executeTextPattern(
    pattern: TextContentPattern,
    site: string,
    maxResults: number,
    adapter: CDPSessionAdapter
  ): Promise<SearchResult[]> {
    const runtimeAgent = adapter.runtimeAgent();

    const script = `
    (function() {
      const results = [];
      const seenUrls = new Set();
      const urlExclusions = ${JSON.stringify(pattern.urlExclusions)};
      const minTextLength = ${pattern.minTextLength};
      const siteHost = '${site.toLowerCase().replace(/^www\\./, '')}';

      // Helper: Check if URL is external
      function isExternalUrl(url, siteHost) {
        try {
          const urlHost = new URL(url).hostname.toLowerCase().replace(/^www\\./, '');
          return !(urlHost.includes(siteHost) || siteHost.includes(urlHost));
        } catch (e) { return false; }
      }

      // BING COPILOT SEARCH: Extract from cite elements (URLs not in hrefs)
      if (siteHost.includes('bing')) {
        document.querySelectorAll('cite').forEach(cite => {
          if (results.length >= ${maxResults}) return;

          const citeText = cite.textContent || '';
          // Convert "https://github.com › user › repo" to "https://github.com/user/repo"
          let url = citeText.replace(/ › /g, '/').trim();
          if (!url.startsWith('http')) url = 'https://' + url;

          // Skip Bing/Microsoft URLs
          if (url.includes('bing.com') || url.includes('microsoft.com')) return;
          if (seenUrls.has(url.toLowerCase())) return;

          // Find container with title and snippet
          let container = cite.parentElement;
          for (let i = 0; i < 8 && container; i++) {
            if (container.querySelector('h2, h3, [class*="title"]')) break;
            container = container.parentElement;
          }

          if (container) {
            const titleEl = container.querySelector('h2, h3, [class*="title"]');
            const title = titleEl?.textContent?.trim() || '';

            if (title.length >= minTextLength) {
              // Try multiple snippet extraction strategies for Bing
              let snippet = '';

              const snippetSelectors = [
                'p:not(:has(cite))',
                '[class*="snippet"]',
                '[class*="caption"]',
                '.b_lineclamp2',
                '.b_algoSlug'
              ];

              for (const sel of snippetSelectors) {
                const el = container.querySelector(sel);
                if (el) {
                  const text = el.textContent?.trim() || '';
                  if (text.length > 20 && !text.includes(' › ')) {
                    snippet = text.substring(0, 200);
                    break;
                  }
                }
              }

              // Fallback: Container text minus title and URL
              if (!snippet) {
                const containerText = container.textContent?.trim() || '';
                let cleaned = containerText
                  .replace(title, '')
                  .replace(/https?:\\/\\/[^\\s]+/g, '')
                  .replace(/[a-z]+\\.[a-z]+\\s*›[^\\n]*/gi, '')
                  .replace(/\\s+/g, ' ')
                  .trim();
                if (cleaned.length > 30) {
                  snippet = cleaned.substring(0, 200);
                }
              }

              seenUrls.add(url.toLowerCase());
              results.push({
                title: title.substring(0, 200),
                url,
                snippet,
                position: results.length + 1
              });
            }
          }
        });

        // If we found Bing Copilot results, return them
        if (results.length > 0) return results;
      }

      // WIKIPEDIA: Extract from .mw-search-result containers (internal URLs)
      if (siteHost.includes('wikipedia')) {
        document.querySelectorAll('.mw-search-result').forEach(result => {
          if (results.length >= ${maxResults}) return;

          const link = result.querySelector('.mw-search-result-heading a');
          const snippetEl = result.querySelector('.searchresult');

          if (link) {
            const url = link.href;
            const title = link.textContent?.trim() || '';

            if (title.length >= 3 && url.includes('/wiki/')) {
              if (seenUrls.has(url.toLowerCase())) return;
              seenUrls.add(url.toLowerCase());

              results.push({
                title: title.substring(0, 200),
                url,
                snippet: snippetEl?.textContent?.trim().substring(0, 200) || '',
                position: results.length + 1
              });
            }
          }
        });
        if (results.length > 0) return results;
      }

      // XPath to find all links
      const xpath = "${pattern.compiledXPath}";
      const iterator = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);

      // Generic title patterns to skip (not actual search results)
      const genericTitles = /^(read more|learn more|see more|view more|more info|continue|click here|here|next|previous|show more|expand|details|info)$/i;

      let node;
      while ((node = iterator.iterateNext()) && results.length < ${maxResults}) {
        const url = node.href;
        const title = node.textContent?.trim() || '';

        // Basic validation
        if (!url || !title || title.length < minTextLength) continue;
        // Skip generic "Read more" type links
        if (genericTitles.test(title)) continue;

        // Check URL exclusions
        const urlLower = url.toLowerCase();
        if (urlExclusions.some(excl => urlLower.includes(excl.toLowerCase()))) continue;

        // Skip duplicate URLs
        if (seenUrls.has(urlLower)) continue;

        // Verify it's an external URL
        try {
          const urlHost = new URL(url).hostname.toLowerCase().replace(/^www\\./, '');
          if (urlHost.includes(siteHost) || siteHost.includes(urlHost)) continue;
        } catch (e) { continue; }

        seenUrls.add(urlLower);

        // Try to extract snippet - use site-specific strategies first
        let snippet = '';

        // Find search result container (larger than immediate parent)
        let container = node.parentElement;
        for (let i = 0; i < 5 && container; i++) {
          // Look for typical result container patterns
          if (container.querySelector('[class*="VwiC3b"]') ||  // Google
              container.querySelector('[class*="b_caption"]') || // Bing
              container.querySelector('.searchmatch')) { // Wikipedia
            break;
          }
          container = container.parentElement;
        }

        if (container) {
          // Strategy 0: Site-specific known snippet classes
          const siteSpecificSelectors = [
            '.VwiC3b', '.lEBKkf', // Google snippet classes
            '.b_caption p', '.b_algoSlug', // Bing snippet classes
            '.searchresult', '.searchmatch', // Wikipedia
            '[data-sncf]', // Google data attribute
          ];

          for (const sel of siteSpecificSelectors) {
            const el = container.querySelector(sel);
            if (el && el !== node && !el.contains(node) && !node.contains(el)) {
              const text = el.textContent?.trim() || '';
              // Make sure it's actually snippet text (not URL or breadcrumb)
              if (text.length > 30 && !text.startsWith('http') && !text.includes(' › ')) {
                snippet = text.slice(0, 200);
                break;
              }
            }
          }

          // Strategy 1: Look for <p> tags with substantial text
          if (!snippet) {
            const ps = container.querySelectorAll('p');
            for (const p of ps) {
              if (p !== node && !p.contains(node) && !node.contains(p)) {
                const text = p.textContent?.trim() || '';
                if (text.length > 30 && !text.startsWith('http') && !text.includes(' › ')) {
                  snippet = text.slice(0, 200);
                  break;
                }
              }
            }
          }

          // Strategy 2: Look for span/div with em tags (highlighted search terms)
          if (!snippet) {
            const emParent = container.querySelector('em')?.parentElement;
            if (emParent && emParent !== node && !emParent.contains(node)) {
              const text = emParent.textContent?.trim() || '';
              if (text.length > 30) {
                snippet = text.slice(0, 200);
              }
            }
          }

          // Strategy 3: Use container text minus title and URL noise
          if (!snippet) {
            const containerText = container.textContent?.trim() || '';
            if (containerText.length > title.length + 50) {
              // Remove title and clean up
              let cleaned = containerText;
              const titleIdx = cleaned.indexOf(title);
              if (titleIdx >= 0) {
                cleaned = cleaned.slice(titleIdx + title.length);
              }
              // Remove URL breadcrumb patterns
              cleaned = cleaned.replace(/https?:\\/\\/[^\\s]+/g, '').replace(/[a-z]+\\.[a-z]+\\s*›[^\\n]*/gi, '');
              cleaned = cleaned.replace(/\\s+/g, ' ').trim();
              if (cleaned.length > 30) {
                snippet = cleaned.slice(0, 200);
              }
            }
          }

          // Clean up snippet
          snippet = snippet.replace(/\\s+/g, ' ').trim();
          if (snippet === title || snippet.startsWith('http')) snippet = '';
        }

        results.push({
          title,
          url,
          snippet,
          position: results.length + 1
        });
      }

      return results;
    })()
    `;

    const result = await runtimeAgent.invoke<{
      result?: { value?: unknown; type?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>('evaluate', {
      expression: script,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      throw new Error(`Text Pattern execution failed: ${result.exceptionDetails.text}`);
    }

    return (result.result?.value || []) as Array<{ title: string; url: string; snippet: string; position: number }>;
  }
}

// ============================================================================
// LLM-ENHANCED STRATEGIES - Use enriched snapshots for better selector generation
// ============================================================================

/**
 * XPath-LLM Strategy
 * Uses XPath-enhanced snapshot so LLM can see actual XPaths for each element.
 * LLM can then generate robust XPath-based selectors instead of guessing CSS classes.
 */
export class XPathLLMStrategy implements SearchStrategy {
  name: SearchStrategyType = 'xpath-llm';
  description = 'LLM with XPath-enhanced snapshot - generates XPath selectors';
  priority = 5;

  async generatePattern(
    options: PatternGenerationOptions,
    adapter: CDPSessionAdapter,
    ctx?: LLMContext
  ): Promise<PatternGenerationResult> {
    logger.info('Generating XPath-LLM pattern', { site: options.site });

    try {
      // Navigate to search page
      const searchUrl = getSearchUrl(options.site, options.sampleQuery);
      const pageAgent = adapter.pageAgent();
      await pageAgent.invoke<{ frameId: string }>('navigate', { url: searchUrl });

      // Wait for results to load
      const config = getSiteConfig(options.site);
      const waitTime = config?.hints?.waitTimeMs || 3000;
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Capture XPath-enhanced snapshot
      const snapshot = await captureHybridSnapshotUniversal(adapter, {
        pierceShadow: true,
        includeXPathInTree: true,  // Include XPath for each element
      });

      const pattern: SearchPattern = {
        id: '',
        site: options.site,
        version: 1,
        strategy: 'xpath-llm',
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        successCount: 0,
        failureCount: 0,
        xpathPattern: {
          searchInputXPath: '',
          resultsSchema: { type: 'object', properties: {} },
          extractionInstruction: '',
        },
        sampleQuery: options.sampleQuery,
        schemaVersion: PATTERN_SCHEMA_VERSION,
      };

      return { success: true, pattern };
    } catch (error) {
      logger.error('Failed to generate XPath-LLM pattern', { error });
      return { success: false, error: String(error) };
    }
  }

  async executePattern(
    options: PatternExecutionOptions,
    adapter: CDPSessionAdapter,
    ctx?: LLMContext
  ): Promise<PatternExecutionResult> {
    const { pattern, query, maxResults } = options;
    const site = pattern.site;

    if (!ctx) {
      return { success: false, results: [], error: 'LLM context required for xpath-llm strategy' };
    }

    try {
      // Navigate to search URL
      const searchUrl = getSearchUrl(site, query);
      const pageAgent = adapter.pageAgent();
      await pageAgent.invoke<{ frameId: string }>('navigate', { url: searchUrl });

      // Wait for results
      const config = getSiteConfig(site);
      const waitTime = config?.hints?.waitTimeMs || 3000;
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Capture XPath-enhanced snapshot
      const snapshot = await captureHybridSnapshotUniversal(adapter, {
        pierceShadow: true,
        includeXPathInTree: true,
      });

      // Smart truncation to stay under token limits
      // Cerebras limit: 131k tokens, OpenAI: 128k, so use ~80k chars (~20k tokens) to be safe
      const MAX_TREE_CHARS = 80000;
      let treeSnippet = snapshot.combinedTree || '';

      if (treeSnippet.length > MAX_TREE_CHARS) {
        logger.info('Truncating tree for token limits', {
          originalChars: treeSnippet.length,
          maxChars: MAX_TREE_CHARS,
          estimatedTokens: Math.ceil(treeSnippet.length / 4),
        });

        // Skip head section, keep body content (search results are in body)
        const bodyMatch = treeSnippet.match(/\n(\s*)\[.*?\] body\b/);
        if (bodyMatch) {
          const bodyStart = bodyMatch.index || 0;
          treeSnippet = treeSnippet.substring(bodyStart);
        }

        // If still too long, truncate from the end (keep beginning which has main results)
        if (treeSnippet.length > MAX_TREE_CHARS) {
          treeSnippet = treeSnippet.substring(0, MAX_TREE_CHARS) + '\n... [truncated]';
        }

        logger.info('Tree truncated', { finalChars: treeSnippet.length });
      }

      // Agent loop: iteratively generate and test scripts
      const MAX_ITERATIONS = 3;
      let lastFeedback = '';
      let bestResults: SearchResult[] = [];

      for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
        logger.debug('XPath-LLM iteration', { site, iteration, hasFeedback: !!lastFeedback });

        // Generate extraction script using LLM
        const script = await this.generateXPathScript(site, treeSnippet, maxResults, ctx, lastFeedback);
        if (!script) {
          lastFeedback = 'LLM failed to generate valid JavaScript code. Ensure code is wrapped in (function() { ... })() and returns an array.';
          continue;
        }

        try {
          // Execute the generated script
          const results = await this.executeScript(script, adapter);

          // Validate and filter results
          const validResults = results.filter(r =>
            r.title && r.title.trim().length > 0 &&
            r.url && r.url.trim().length > 0
          );

          // Track best results so far
          if (validResults.length > bestResults.length) {
            bestResults = validResults;
          }

          // Check if results meet quality threshold
          const hasEnoughResults = validResults.length >= maxResults;
          const hasSnippets = validResults.every(r => (r.snippet?.length || 0) > 10);

          if (hasEnoughResults && hasSnippets) {
            logger.info('XPath-LLM succeeded', { site, iteration, resultCount: validResults.length });
            return { success: true, results: validResults.slice(0, maxResults) };
          }

          // Generate feedback for next iteration
          lastFeedback = this.generateFeedback(validResults, maxResults);
          logger.debug('XPath-LLM iteration needs improvement', { iteration, feedback: lastFeedback });

        } catch (execError) {
          lastFeedback = `Script execution error: ${execError instanceof Error ? execError.message : String(execError)}. Check for syntax errors.`;
          logger.warn('XPath-LLM script execution failed', { iteration, error: lastFeedback });
        }
      }

      // Return best results found (even if not perfect)
      if (bestResults.length > 0) {
        logger.info('XPath-LLM returning best effort results', { site, resultCount: bestResults.length });
        return { success: true, results: bestResults.slice(0, maxResults) };
      }

      return { success: false, results: [], error: 'Failed to extract results after multiple attempts' };
    } catch (error) {
      logger.error('XPath-LLM execution failed', { error });
      return { success: false, results: [], error: String(error) };
    }
  }

  /**
   * Generate feedback for LLM to improve extraction script
   */
  private generateFeedback(results: SearchResult[], expectedCount: number): string {
    const issues: string[] = [];

    if (results.length === 0) {
      return 'Script returned ZERO results. Check that your XPath expressions match elements on the page. Look for link elements with external URLs.';
    }

    if (results.length < expectedCount) {
      issues.push(`Found only ${results.length}/${expectedCount} results. Widen your XPath pattern to capture more external links.`);
    }

    const missingSnippets = results.filter(r => !(r.snippet?.length && r.snippet.length > 10));
    if (missingSnippets.length > 0) {
      issues.push(`${missingSnippets.length} results missing snippets. Look for text content near each link (sibling elements, parent containers).`);
    }

    const emptyTitles = results.filter(r => !(r.title?.trim()));
    if (emptyTitles.length > 0) {
      issues.push(`${emptyTitles.length} results have empty titles. Use link text content or nearby heading elements.`);
    }

    return issues.length > 0 ? issues.join('\n') : 'Results look good but need minor improvements.';
  }

  private async generateXPathScript(
    site: string,
    treeSnippet: string,
    maxResults: number,
    ctx: LLMContext,
    previousFeedback?: string
  ): Promise<string | null> {
    const systemPrompt = `You are a JavaScript code generation expert specializing in web scraping.
Your task is to generate a JavaScript function that extracts ORGANIC search results using XPath.

IMPORTANT: The accessibility tree below includes XPath for each element in [xpath: ...] format.
Use these ACTUAL XPaths to build robust selectors - don't guess!

CRITICAL RULES:
1. Generate ONLY executable JavaScript code that returns an array of result objects
2. Each result object must have: { title, url, snippet, position }
3. Use document.evaluate() with XPath expressions for DOM traversal
4. Return immediately executable code (no imports, no async, no external dependencies)
5. NEVER hallucinate - base selectors on the actual XPaths provided in [xpath: ...] format
6. Code must be wrapped in an IIFE: (function() { ... })()
7. Return an array, even if empty
8. Use .trim() for all text extraction
9. Handle missing elements gracefully with null checks
10. ENSURE UNIQUE RESULTS - never select the same element multiple times
11. Each result MUST have a DIFFERENT URL - deduplicate by URL
12. Use STRUCTURAL XPath patterns, NOT query-specific text matching
13. The selector must work for ANY search query on this site, not just the example
14. Find ALL results in the list/grid, not just a subset
15. Limit to ${maxResults} results maximum

WHAT ARE ORGANIC SEARCH RESULTS:
- They link to EXTERNAL websites (not ${site})
- They have a title (clickable heading), URL displayed, and a text snippet/description
- They are the main content of the page, not navigation or filters
- On Google: look for links to external domains like wikipedia.org, stackoverflow.com, etc.
- On Bing: look for cite elements showing external URLs
- On Wikipedia: look for links to /wiki/ article pages

WHAT TO SKIP:
- Navigation links (Home, Images, Videos, News tabs)
- Filter buttons ("AI Mode", "All", "Shopping", etc.)
- Site menu and app icons
- Ads/sponsored content (often marked with "Ad" or "Sponsored")
- Related searches and "People also ask"
- Site header/footer elements
- Login/signup links
- Pagination links

OUTPUT FORMAT:
Return ONLY the JavaScript code wrapped in markdown code blocks:
\`\`\`javascript
(function() {
  const results = [];
  // Your extraction code using document.evaluate() with XPath
  return results;
})()
\`\`\``;

    let userPrompt = `SITE: ${site}

ACCESSIBILITY TREE WITH XPATH (each element shows its actual XPath in [xpath: ...]):
\`\`\`
${treeSnippet}
\`\`\`

TASK: Generate JavaScript code that extracts ORGANIC search results using XPath.
- Look at the [xpath: ...] annotations to see exact element paths
- Find links to EXTERNAL domains (not ${site})
- Extract: title, url, snippet, position (1-indexed)
- Skip navigation, ads, and internal site links
- Return up to ${maxResults} results`;

    if (previousFeedback) {
      userPrompt += `

PREVIOUS ATTEMPT FAILED - PLEASE FIX:
${previousFeedback}

Common issues:
- XPath returning no matches (check the tree for correct paths)
- Missing snippets (look for nearby text elements after the link)
- Not enough results (widen the XPath pattern)
- Syntax errors (ensure proper escaping)`;
    }

    try {
      const model = ctx.miniModel || ctx.model;
      const response = await callLLMWithTracing(
        {
          provider: ctx.provider,
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          systemPrompt,
          temperature: 0.1,
        },
        {
          toolName: 'xpath_llm_strategy',
          operationName: 'generate_xpath_script',
          context: `XPath script generation for ${site}`,
        }
      );

      const code = this.extractCode(response.text || '');
      return code;
    } catch (error) {
      logger.error('LLM call failed for XPath-LLM strategy', { error });
      return null;
    }
  }

  private extractCode(response: string): string | null {
    const match = response.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
    let code = match ? match[1].trim() : response.trim();

    if (!code || code.length < 30) return null;
    if (!code.includes('function') && !code.includes('return')) return null;

    // Wrap in IIFE if needed
    if (!code.startsWith('(function')) {
      code = `(function() {\n${code}\n})()`;
    }

    return code;
  }

  private async executeScript(
    script: string,
    adapter: CDPSessionAdapter
  ): Promise<SearchResult[]> {
    const runtimeAgent = adapter.runtimeAgent();

    const result = await runtimeAgent.invoke<{
      result?: { value?: unknown };
      exceptionDetails?: { text?: string };
    }>('evaluate', {
      expression: script,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      throw new Error(`Script execution failed: ${result.exceptionDetails.text}`);
    }

    const data = result.result?.value;
    if (!Array.isArray(data)) return [];

    return data.map((r: any, i: number) => ({
      title: String(r.title || '').trim(),
      url: String(r.url || ''),
      snippet: String(r.snippet || '').trim(),
      position: i + 1,  // Always use array index for reliable ordering
    }));
  }
}

/**
 * CSS-LLM Strategy
 * Uses CSS-enhanced snapshot so LLM can see actual CSS classes for each element.
 * LLM can then generate accurate CSS selectors using the real class names.
 */
export class CSSLLMStrategy implements SearchStrategy {
  name: SearchStrategyType = 'css-llm';
  description = 'LLM with CSS-enhanced snapshot - generates CSS selectors with real classes';
  priority = 6;

  async generatePattern(
    options: PatternGenerationOptions,
    adapter: CDPSessionAdapter,
    ctx?: LLMContext
  ): Promise<PatternGenerationResult> {
    logger.info('Generating CSS-LLM pattern', { site: options.site });

    try {
      // Navigate to search page
      const searchUrl = getSearchUrl(options.site, options.sampleQuery);
      const pageAgent = adapter.pageAgent();
      await pageAgent.invoke<{ frameId: string }>('navigate', { url: searchUrl });

      // Wait for results to load
      const config = getSiteConfig(options.site);
      const waitTime = config?.hints?.waitTimeMs || 3000;
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Capture CSS-enhanced snapshot
      const snapshot = await captureHybridSnapshotUniversal(adapter, {
        pierceShadow: true,
        includeCssClassesInTree: true,  // Include CSS classes for each element
      });

      const pattern: SearchPattern = {
        id: '',
        site: options.site,
        version: 1,
        strategy: 'css-llm',
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        successCount: 0,
        failureCount: 0,
        xpathPattern: {
          searchInputXPath: '',
          resultsSchema: { type: 'object', properties: {} },
          extractionInstruction: '',
        },
        sampleQuery: options.sampleQuery,
        schemaVersion: PATTERN_SCHEMA_VERSION,
      };

      return { success: true, pattern };
    } catch (error) {
      logger.error('Failed to generate CSS-LLM pattern', { error });
      return { success: false, error: String(error) };
    }
  }

  async executePattern(
    options: PatternExecutionOptions,
    adapter: CDPSessionAdapter,
    ctx?: LLMContext
  ): Promise<PatternExecutionResult> {
    const { pattern, query, maxResults } = options;
    const site = pattern.site;

    if (!ctx) {
      return { success: false, results: [], error: 'LLM context required for css-llm strategy' };
    }

    try {
      // Navigate to search URL
      const searchUrl = getSearchUrl(site, query);
      const pageAgent = adapter.pageAgent();
      await pageAgent.invoke<{ frameId: string }>('navigate', { url: searchUrl });

      // Wait for results
      const config = getSiteConfig(site);
      const waitTime = config?.hints?.waitTimeMs || 3000;
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Capture CSS-enhanced snapshot
      const snapshot = await captureHybridSnapshotUniversal(adapter, {
        pierceShadow: true,
        includeCssClassesInTree: true,
      });

      // Smart truncation to stay under token limits
      const MAX_TREE_CHARS = 80000;
      let treeSnippet = snapshot.combinedTree || '';

      if (treeSnippet.length > MAX_TREE_CHARS) {
        logger.info('Truncating tree for token limits', {
          originalChars: treeSnippet.length,
          maxChars: MAX_TREE_CHARS,
          estimatedTokens: Math.ceil(treeSnippet.length / 4),
        });

        // Skip head section, keep body content (search results are in body)
        const bodyMatch = treeSnippet.match(/\n(\s*)\[.*?\] body\b/);
        if (bodyMatch) {
          const bodyStart = bodyMatch.index || 0;
          treeSnippet = treeSnippet.substring(bodyStart);
        }

        // If still too long, truncate from the end (keep beginning which has main results)
        if (treeSnippet.length > MAX_TREE_CHARS) {
          treeSnippet = treeSnippet.substring(0, MAX_TREE_CHARS) + '\n... [truncated]';
        }

        logger.info('Tree truncated', { finalChars: treeSnippet.length });
      }

      // Agent loop: iteratively generate and test scripts
      const MAX_ITERATIONS = 3;
      let lastFeedback = '';
      let bestResults: SearchResult[] = [];

      for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
        logger.debug('CSS-LLM iteration', { site, iteration, hasFeedback: !!lastFeedback });

        // Generate extraction script using LLM
        const script = await this.generateCSSScript(site, treeSnippet, maxResults, ctx, lastFeedback);
        if (!script) {
          lastFeedback = 'LLM failed to generate valid JavaScript code. Ensure code is wrapped in (function() { ... })() and returns an array.';
          continue;
        }

        try {
          // Execute the generated script
          const results = await this.executeScript(script, adapter);

          // Validate and filter results
          const validResults = results.filter(r =>
            r.title && r.title.trim().length > 0 &&
            r.url && r.url.trim().length > 0
          );

          // Track best results so far
          if (validResults.length > bestResults.length) {
            bestResults = validResults;
          }

          // Check if results meet quality threshold
          const hasEnoughResults = validResults.length >= maxResults;
          const hasSnippets = validResults.every(r => (r.snippet?.length || 0) > 10);

          if (hasEnoughResults && hasSnippets) {
            logger.info('CSS-LLM succeeded', { site, iteration, resultCount: validResults.length });
            return { success: true, results: validResults.slice(0, maxResults) };
          }

          // Generate feedback for next iteration
          lastFeedback = this.generateFeedback(validResults, maxResults);
          logger.debug('CSS-LLM iteration needs improvement', { iteration, feedback: lastFeedback });

        } catch (execError) {
          lastFeedback = `Script execution error: ${execError instanceof Error ? execError.message : String(execError)}. Check for syntax errors.`;
          logger.warn('CSS-LLM script execution failed', { iteration, error: lastFeedback });
        }
      }

      // Return best results found (even if not perfect)
      if (bestResults.length > 0) {
        logger.info('CSS-LLM returning best effort results', { site, resultCount: bestResults.length });
        return { success: true, results: bestResults.slice(0, maxResults) };
      }

      return { success: false, results: [], error: 'Failed to extract results after multiple attempts' };
    } catch (error) {
      logger.error('CSS-LLM execution failed', { error });
      return { success: false, results: [], error: String(error) };
    }
  }

  /**
   * Generate feedback for LLM to improve extraction script
   */
  private generateFeedback(results: SearchResult[], expectedCount: number): string {
    const issues: string[] = [];

    if (results.length === 0) {
      return 'Script returned ZERO results. Check that your CSS selectors match elements on the page. Look for containers with class names containing "result" or "search".';
    }

    if (results.length < expectedCount) {
      issues.push(`Found only ${results.length}/${expectedCount} results. Use broader CSS selectors to capture more results.`);
    }

    const missingSnippets = results.filter(r => !(r.snippet?.length && r.snippet.length > 10));
    if (missingSnippets.length > 0) {
      issues.push(`${missingSnippets.length} results missing snippets. Look for nearby elements with description/caption classes.`);
    }

    const emptyTitles = results.filter(r => !(r.title?.trim()));
    if (emptyTitles.length > 0) {
      issues.push(`${emptyTitles.length} results have empty titles. Use link text content or nearby heading elements.`);
    }

    return issues.length > 0 ? issues.join('\n') : 'Results look good but need minor improvements.';
  }

  private async generateCSSScript(
    site: string,
    treeSnippet: string,
    maxResults: number,
    ctx: LLMContext,
    previousFeedback?: string
  ): Promise<string | null> {
    const systemPrompt = `You are a JavaScript code generation expert specializing in web scraping.
Your task is to generate a JavaScript function that extracts ORGANIC search results using CSS selectors.

IMPORTANT: The accessibility tree below includes CSS classes for each element in [class: ...] format.
Use these ACTUAL class names to build accurate selectors - don't guess!

CRITICAL RULES:
1. Generate ONLY executable JavaScript code that returns an array of result objects
2. Each result object must have: { title, url, snippet, position }
3. Use document.querySelectorAll() with CSS selectors for DOM traversal
4. Return immediately executable code (no imports, no async, no external dependencies)
5. NEVER hallucinate - base selectors on the actual CSS classes provided in [class: ...] format
6. Code must be wrapped in an IIFE: (function() { ... })()
7. Return an array, even if empty
8. Use .trim() for all text extraction
9. Handle missing elements gracefully with optional chaining (?.)
10. ENSURE UNIQUE RESULTS - never select the same element multiple times
11. Use querySelectorAll ONCE to get all items, then iterate - do NOT use querySelector in a loop
12. Each result MUST have a DIFFERENT URL - deduplicate by URL before returning
13. Use STRUCTURAL selectors (CSS classes, data attributes) NOT query-specific patterns
14. The selector must work for ANY search query on this site, not just the example
15. Find ALL results in the list/grid, not just a subset

WHAT ARE ORGANIC SEARCH RESULTS:
- They link to EXTERNAL websites (not ${site})
- They have a title (clickable heading), URL displayed, and a text snippet/description
- They are the main content of the page, not navigation or filters
- On Google: look for links with classes containing result-related names
- On Bing: look for cite elements and their parent containers
- On Wikipedia: look for .mw-search-result containers

WHAT TO SKIP:
- Navigation links (Home, Images, Videos, News tabs)
- Filter buttons ("AI Mode", "All", "Shopping", etc.)
- Site menu and app icons
- Ads/sponsored content (often marked with "Ad" or "Sponsored")
- Related searches and "People also ask"
- Site header/footer elements
- Login/signup links
- Pagination links

OUTPUT FORMAT:
Return ONLY the JavaScript code wrapped in markdown code blocks:
\`\`\`javascript
(function() {
  const results = [];
  const seenUrls = new Set();
  // Your extraction code using querySelectorAll with actual CSS classes
  return results;
})()
\`\`\``;

    let userPrompt = `SITE: ${site}

ACCESSIBILITY TREE WITH CSS CLASSES (each element shows its actual classes in [class: ...]):
\`\`\`
${treeSnippet}
\`\`\`

TASK: Generate JavaScript code that extracts ORGANIC search results using CSS selectors.
- Look at the [class: ...] annotations to see actual class names
- Find links to EXTERNAL domains (not ${site})
- Extract: title, url, snippet, position (1-indexed)
- Skip navigation, ads, and internal site links
- Return up to ${maxResults} results`;

    if (previousFeedback) {
      userPrompt += `

PREVIOUS ATTEMPT FAILED - PLEASE FIX:
${previousFeedback}

Common issues:
- CSS selector returning no matches (check the tree for correct class names)
- Missing snippets (look for nearby elements with description/caption classes)
- Not enough results (use broader selectors like [class*="result"])
- Duplicate URLs (ensure deduplication with Set)`;
    }

    try {
      const model = ctx.miniModel || ctx.model;
      const response = await callLLMWithTracing(
        {
          provider: ctx.provider,
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          systemPrompt,
          temperature: 0.1,
        },
        {
          toolName: 'css_llm_strategy',
          operationName: 'generate_css_script',
          context: `CSS script generation for ${site}`,
        }
      );

      const code = this.extractCode(response.text || '');
      return code;
    } catch (error) {
      logger.error('LLM call failed for CSS-LLM strategy', { error });
      return null;
    }
  }

  private extractCode(response: string): string | null {
    const match = response.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
    let code = match ? match[1].trim() : response.trim();

    if (!code || code.length < 30) return null;
    if (!code.includes('function') && !code.includes('return')) return null;

    // Wrap in IIFE if needed
    if (!code.startsWith('(function')) {
      code = `(function() {\n${code}\n})()`;
    }

    return code;
  }

  private async executeScript(
    script: string,
    adapter: CDPSessionAdapter
  ): Promise<SearchResult[]> {
    const runtimeAgent = adapter.runtimeAgent();

    const result = await runtimeAgent.invoke<{
      result?: { value?: unknown };
      exceptionDetails?: { text?: string };
    }>('evaluate', {
      expression: script,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      throw new Error(`Script execution failed: ${result.exceptionDetails.text}`);
    }

    const data = result.result?.value;
    if (!Array.isArray(data)) return [];

    return data.map((r: any, i: number) => ({
      title: String(r.title || '').trim(),
      url: String(r.url || ''),
      snippet: String(r.snippet || '').trim(),
      position: i + 1,  // Always use array index for reliable ordering
    }));
  }
}

// ============================================================================
// STRATEGY REGISTRY
// ============================================================================

/**
 * Get all available strategies
 */
export function getStrategies(): SearchStrategy[] {
  return [
    new XPathSchemaStrategy(),
    new SemanticXPathStrategy(),
    new EncodedIdStrategy(),
    new TextPatternStrategy(),
    new XPathLLMStrategy(),
    new CSSLLMStrategy(),
  ];
}

/**
 * Get strategy by name
 */
export function getStrategy(name: SearchStrategyType): SearchStrategy | null {
  const strategies = getStrategies();
  return strategies.find(s => s.name === name) || null;
}

/**
 * Get preferred strategy for a site
 */
export function getPreferredStrategy(site: string): SearchStrategy {
  const config = getSiteConfig(site);
  if (config) {
    const strategy = getStrategy(config.preferredStrategy);
    if (strategy) {
      return strategy;
    }
  }
  // Default to XPath strategy
  return new XPathSchemaStrategy();
}
