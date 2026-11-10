// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../core/Logger.js';
import type { Tool, LLMContext } from './Tools.js';
import type { SchemaDefinition } from './SchemaBasedExtractorTool.js';
import { SchemaBasedExtractorTool } from './SchemaBasedExtractorTool.js';
import { SelectorCache } from './selector_cache/SelectorCache.js';
import type {
  CachedSchemaExtractionArgs,
  CachedSchemaExtractionResult,
  SelectorScore,
} from './selector_cache/types.js';
import { callLLMWithTracing } from './LLMTracingWrapper.js';
import { getAdapter } from '../cdp/getAdapter.js';
import { captureHybridSnapshotUniversal } from '../a11y/HybridSnapshotUniversal.js';
import type { CDPSessionAdapter } from '../cdp/CDPSessionAdapter.js';

const logger = createLogger('Tool:CachedSchemaExtractor');

/**
 * Schema-based extraction with JavaScript selector caching.
 *
 * Flow:
 * 1. Check cache for existing selector
 * 2. If cached: Execute selector via Runtime.evaluate (fast path, ~50-200ms)
 * 3. If not cached:
 *    a. Use SchemaBasedExtractorTool for ground truth
 *    b. Generate JavaScript selector with LLM agent loop
 *    c. Cache selector for future use
 * 4. Return extracted data
 */
export class CachedSchemaExtractorTool implements Tool<CachedSchemaExtractionArgs, CachedSchemaExtractionResult> {
  name = 'extract_cached';
  description = `Extracts structured data using JSON schema with JavaScript selector caching.
First call: Uses LLM extraction to generate a fast JavaScript selector.
Subsequent calls: Executes cached selector directly (50-200ms vs 5-15s).

Best for: Repeated extractions with same schema (search results, product listings, news feeds).

Arguments:
- schema: JSON Schema definition of data to extract
- instruction: Natural language extraction instruction
- pathPattern: URL path pattern for cache key (e.g., "/search", "/products")
- cacheKey: (Optional) Custom cache key for manual control
- forceRefresh: (Optional) Force regeneration even if cached

Schema examples:
- Product list: {"type": "object", "properties": {"items": {"type": "array", "items": {"type": "object", "properties": {"title": {"type": "string"}, "price": {"type": "number"}}}}}}
- Search results: {"type": "object", "properties": {"results": {"type": "array", "items": {"type": "object", "properties": {"title": {"type": "string"}, "url": {"type": "string", "format": "url"}}}}}}`;

  schema = {
    type: 'object',
    properties: {
      schema: {
        type: 'object',
        description: 'JSON Schema definition of data to extract',
      },
      instruction: {
        type: 'string',
        description: 'Natural language instruction for extraction',
      },
      reasoning: {
        type: 'string',
        description: 'Reasoning about the extraction (displayed to user)',
      },
      pathPattern: {
        type: 'string',
        description: 'URL path pattern (e.g., "/search", "/products") - defaults to current path',
      },
      cacheKey: {
        type: 'string',
        description: 'Custom cache key (overrides auto-generation)',
      },
      forceRefresh: {
        type: 'boolean',
        description: 'Force cache refresh',
      },
    },
    required: ['schema', 'instruction'],
  };

  private readonly MAX_ITERATIONS = 5;
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private readonly groundTruthTool = new SchemaBasedExtractorTool();
  private readonly cache = SelectorCache.getInstance();

  async execute(
    args: CachedSchemaExtractionArgs,
    ctx?: LLMContext
  ): Promise<CachedSchemaExtractionResult> {
    const startTime = Date.now();

    try {
      const adapter = await getAdapter(ctx);
      if (!adapter) {
        return {
          success: false,
          error: 'No browser connection available',
          data: null,
          cached: false,
        };
      }

      // Get current URL for cache key generation
      const pageAgent = adapter.pageAgent();
      const frameTree = await pageAgent.invoke<{ frameTree: { frame: { url: string } } }>('getFrameTree', {});
      const currentUrl = frameTree.frameTree?.frame?.url || '';

      let domain: string;
      let pathPattern: string;

      try {
        const urlObj = new URL(currentUrl);
        domain = urlObj.hostname;
        // Use first path segment as default pattern
        const pathSegments = urlObj.pathname.split('/').filter(Boolean);
        pathPattern = args.pathPattern || (pathSegments[0] ? `/${pathSegments[0]}` : '/');
      } catch {
        domain = 'unknown';
        pathPattern = args.pathPattern || '/';
      }

      // Generate cache key
      const cacheKey = await this.cache.generateCacheKey(
        domain,
        pathPattern,
        args.schema,
        args.cacheKey
      );

      logger.debug('Cache key generated', { cacheKey, domain, pathPattern });

      // Try cached selector first (unless force refresh)
      if (!args.forceRefresh) {
        const cached = await this.cache.get(cacheKey);
        if (cached) {
          logger.info('Using cached selector', { cacheKey });
          try {
            const data = await this.executeCachedSelector(cached.selectorScript, adapter);
            await this.cache.recordSuccess(cacheKey);

            return {
              success: true,
              data,
              cached: true,
              cacheKey,
              executionTimeMs: Date.now() - startTime,
            };
          } catch (error) {
            logger.warn('Cached selector failed, falling back to ground truth', {
              cacheKey,
              error: error instanceof Error ? error.message : String(error),
            });
            await this.cache.recordFailure(cacheKey);
            // Fall through to ground truth extraction
          }
        }
      }

      // No cache or cache failed - use ground truth extraction
      logger.info('Performing ground truth extraction', { cacheKey });
      const groundTruth = await this.groundTruthTool.execute(
        {
          schema: args.schema as SchemaDefinition,
          instruction: args.instruction,
          reasoning: args.reasoning || 'Extracting data from page',
        },
        ctx
      );

      if (!groundTruth.success || !groundTruth.data) {
        return {
          success: false,
          error: groundTruth.error || 'Ground truth extraction failed',
          data: null,
          cached: false,
        };
      }

      // Generate and cache selector for future use (async, don't block response)
      this.generateAndCacheSelector(
        cacheKey,
        args.schema,
        args.instruction,
        groundTruth.data,
        adapter,
        ctx
      ).catch(error => {
        logger.warn('Selector generation failed (non-blocking)', {
          cacheKey,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      return {
        success: true,
        data: groundTruth.data,
        cached: false,
        cacheKey,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      logger.error('Execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        data: null,
        cached: false,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute cached JavaScript selector via Runtime.evaluate
   */
  private async executeCachedSelector(
    selectorScript: string,
    adapter: CDPSessionAdapter
  ): Promise<unknown> {
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
      const errorMsg =
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        'Unknown error';
      throw new Error(`Selector execution failed: ${errorMsg}`);
    }

    const data = result.result?.value;
    if (data === undefined || data === null) {
      throw new Error('Selector returned no data');
    }

    return data;
  }

  /**
   * Generate JavaScript selector using LLM agent loop and cache it.
   * Adapted from SearchStrategy.generateCachedSelector()
   */
  private async generateAndCacheSelector(
    cacheKey: string,
    schema: object,
    instruction: string,
    groundTruthData: unknown,
    adapter: CDPSessionAdapter,
    ctx?: LLMContext
  ): Promise<void> {
    if (!ctx?.provider || (!ctx.miniModel && !ctx.model)) {
      logger.debug('No LLM context for selector generation');
      return;
    }

    // Capture accessibility tree snippet for LLM context
    let treeSnippet = '';
    try {
      const snapshot = await captureHybridSnapshotUniversal(adapter, { pierceShadow: true });
      treeSnippet = (snapshot.combinedTree || '').substring(0, 5000);
    } catch (error) {
      logger.warn('Failed to capture tree snippet', { error });
      return;
    }

    // Agent loop: iteratively test and refine selectors
    let lastFeedback = '';
    let bestSelector: string | null = null;
    let bestScore = 0;
    let consecutiveFailures = 0;

    for (let iteration = 1; iteration <= this.MAX_ITERATIONS; iteration++) {
      if (consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        logger.warn('Exiting early due to consecutive failures', {
          iteration,
          consecutiveFailures,
        });
        break;
      }

      logger.debug('Selector generation iteration', { iteration, cacheKey });

      // Generate candidate selector
      const candidateScript = await this.buildSelectorScriptWithLLM(
        schema,
        instruction,
        groundTruthData,
        treeSnippet,
        ctx,
        lastFeedback
      );

      if (!candidateScript) {
        lastFeedback =
          'LLM failed to generate valid JavaScript. Ensure code is wrapped in (function() { ... })() and returns data.';
        consecutiveFailures++;
        continue;
      }

      // Test candidate
      try {
        const testData = await this.executeCachedSelector(candidateScript, adapter);
        const score = this.scoreSelector(testData, groundTruthData);

        logger.debug('Selector scored', {
          iteration,
          coverage: Math.round(score.coverage * 100) + '%',
          uniqueRate: Math.round(score.uniqueRate * 100) + '%',
          valid: score.valid,
          perfect: score.perfect,
        });

        // Track best selector
        const totalScore = score.coverage * 0.5 + score.uniqueRate * 0.5;
        if (score.valid && totalScore > bestScore) {
          bestSelector = candidateScript;
          bestScore = totalScore;
        }

        // If perfect, cache and return
        if (score.perfect) {
          logger.info('Generated perfect selector', { cacheKey, iteration });
          const schemaHash = await this.cache.hashSchema(schema);
          await this.cache.save(cacheKey, candidateScript, schemaHash);
          return;
        }

        lastFeedback = score.feedback;
        consecutiveFailures = 0;
      } catch (error) {
        lastFeedback = `Selector execution error: ${error instanceof Error ? error.message : String(error)}`;
        consecutiveFailures++;
      }
    }

    // Cache best selector if found
    if (bestSelector) {
      logger.info('Caching best selector found', { cacheKey, score: bestScore });
      const schemaHash = await this.cache.hashSchema(schema);
      await this.cache.save(cacheKey, bestSelector, schemaHash);
    } else {
      logger.warn('All selector generation attempts failed', { cacheKey });
    }
  }

  /**
   * Generate JavaScript selector using LLM.
   * Adapted from SearchStrategy.buildSelectorScriptWithLLM()
   */
  private async buildSelectorScriptWithLLM(
    schema: object,
    instruction: string,
    groundTruthData: unknown,
    treeSnippet: string,
    ctx: LLMContext,
    previousError?: string
  ): Promise<string | null> {
    const systemPrompt = `You are a JavaScript code generation expert for web scraping.
Generate executable JavaScript that extracts data from a web page according to a schema.

CRITICAL RULES:
1. Return ONLY executable JavaScript wrapped in IIFE: (function() { ... })()
2. Use document.querySelector/querySelectorAll for DOM traversal
3. Return data matching the schema structure exactly
4. Handle missing elements with optional chaining (?.)
5. Use .trim() for text extraction
6. Return the data object/array - do NOT use console.log
7. Code must be immediately executable (no imports, no async, no external dependencies)
8. ENSURE UNIQUE RESULTS - use querySelectorAll ONCE, not querySelector in a loop
9. Use STRUCTURAL selectors (CSS classes, data attributes) NOT content-specific patterns
10. The selector must work for ANY content on this page type, not just the example

OUTPUT FORMAT:
\`\`\`javascript
(function() {
  // Your extraction code here
  return extractedData;
})()
\`\`\``;

    const exampleData = JSON.stringify(groundTruthData, null, 2).substring(0, 1500);

    let userPrompt = `SCHEMA:
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

INSTRUCTION: ${instruction}

ACCESSIBILITY TREE SNIPPET (showing DOM structure):
\`\`\`
${treeSnippet}
\`\`\`

EXPECTED OUTPUT EXAMPLE (from ground truth extraction):
\`\`\`json
${exampleData}
\`\`\`

Generate JavaScript code that extracts data matching this schema and structure from the DOM.
Study the accessibility tree to understand the DOM structure and use appropriate CSS selectors.`;

    if (previousError) {
      userPrompt += `

PREVIOUS ATTEMPT FAILED: ${previousError}

Fix the code to address this error. Common issues:
- Incorrect CSS selectors (check the accessibility tree for correct element structure)
- Elements not present in DOM (use optional chaining)
- Syntax errors in JavaScript
- Not returning the correct data structure`;
    }

    try {
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
          temperature: 0.2,
          options: { retryConfig: { maxRetries: 2, baseDelayMs: 1000 } },
        },
        {
          toolName: this.name,
          operationName: 'generate_selector',
          context: 'selector_generation',
        }
      );

      const responseText = llmResponse.text || '';
      return this.extractJavaScriptFromResponse(responseText);
    } catch (error) {
      logger.error('Error generating selector with LLM:', error);
      return null;
    }
  }

  /**
   * Extract JavaScript code from LLM response.
   * Handles markdown code blocks and basic validation.
   * Adapted from SearchStrategy.extractJavaScriptFromResponse()
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

    // Ensure code is wrapped in IIFE
    code = code.trim();

    // Check if already a properly formed IIFE
    const isProperIIFE = /^\(function\s*\([^)]*\)\s*\{[\s\S]*\}\s*\)\s*\(\s*\)$/.test(code);

    if (!isProperIIFE) {
      // Remove any trailing () that might cause double-invocation
      code = code.replace(/\(\s*\)\s*$/, '').trim();

      // Check if it's a function expression without invocation
      const isFunctionExpr = /^\(function\s*\([^)]*\)\s*\{[\s\S]*\}\s*\)$/.test(code);
      if (isFunctionExpr) {
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
   * Score selector quality against ground truth.
   * Adapted from SearchStrategy.scoreSelector()
   */
  private scoreSelector(extractedData: unknown, groundTruthData: unknown): SelectorScore {
    // Normalize to arrays for comparison
    const normalize = (data: unknown): unknown[] => {
      if (Array.isArray(data)) return data;
      if (data && typeof data === 'object') {
        // Handle objects with array properties (e.g., { results: [...] })
        const values = Object.values(data as Record<string, unknown>);
        const arrayProp = values.find(v => Array.isArray(v));
        if (arrayProp) return arrayProp as unknown[];
      }
      return data !== null && data !== undefined ? [data] : [];
    };

    const extracted = normalize(extractedData);
    const groundTruth = normalize(groundTruthData);

    // Handle empty ground truth
    if (groundTruth.length === 0) {
      return {
        coverage: extracted.length === 0 ? 1 : 0,
        uniqueRate: 1,
        totalFound: extracted.length,
        valid: extracted.length === 0,
        perfect: extracted.length === 0,
        feedback: extracted.length === 0 ? 'Both empty' : 'Ground truth is empty but selector found data',
      };
    }

    // Calculate coverage (how many ground truth items were found)
    const coverage = Math.min(extracted.length / groundTruth.length, 1.0);

    // Calculate uniqueness (no duplicates)
    const uniqueCount = new Set(extracted.map(item => JSON.stringify(item))).size;
    const uniqueRate = extracted.length > 0 ? uniqueCount / extracted.length : 1;

    // Validation thresholds
    const valid = coverage >= 0.7 && uniqueRate >= 0.9 && extracted.length > 0;
    const perfect = coverage >= 0.95 && uniqueRate >= 0.95;

    // Generate feedback for LLM
    const issues: string[] = [];
    if (extracted.length === 0) {
      issues.push('Selector returned ZERO results. Check that your CSS selector matches elements on the page.');
    }
    if (coverage < 0.7) {
      issues.push(
        `Low coverage (${Math.round(coverage * 100)}%). Selector found ${extracted.length} items but should find ~${groundTruth.length}. Use broader CSS selectors.`
      );
    }
    if (uniqueRate < 0.9) {
      const duplicates = extracted.length - uniqueCount;
      issues.push(
        `Found ${duplicates} DUPLICATE items. Use querySelectorAll() once on the container, not multiple querySelector() calls.`
      );
    }

    return {
      coverage,
      uniqueRate,
      totalFound: extracted.length,
      valid,
      perfect,
      feedback: issues.length > 0 ? issues.join('\n') : 'Good quality selector',
    };
  }
}
