// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../core/Logger.js';
import { waitForPageLoad, type Tool, type LLMContext } from './Tools.js';
import { READABILITY_SOURCE } from '../vendor/readability-source.js';
import { HTMLToMarkdownTool } from './HTMLToMarkdownTool.js';

// Detect if we're in a Node.js environment (eval runner, tests)
const isNodeEnvironment = typeof window === 'undefined' || typeof document === 'undefined';

// Lazy-loaded browser-only SDK dependency
let SDK: typeof import('../../../core/sdk/sdk.js') | null = null;
let sdkLoaded = false;

async function ensureSDK(): Promise<boolean> {
  if (isNodeEnvironment) return false;
  if (!sdkLoaded) {
    sdkLoaded = true;
    try { SDK = await import('../../../core/sdk/sdk.js'); }
    catch { return false; }
  }
  return SDK !== null;
}

const logger = createLogger('Tool:ReadabilityExtractor');

// Minimum content length to consider Readability extraction successful
const MIN_CONTENT_LENGTH = 3000;

/**
 * Result interface for Readability extraction
 */
export interface ReadabilityExtractorResult {
  success: boolean;
  textContent: string | null;
  title?: string;
  byline?: string;
  excerpt?: string;
  siteName?: string;
  error?: string;
}

/**
 * Arguments for Readability extraction
 */
export interface ReadabilityExtractorArgs {
  instruction?: string;
  reasoning: string;
}

/**
 * Tool for extracting the main article content from a webpage using Mozilla Readability.
 * Returns plain text content without requiring LLM calls.
 * Uses bundled Readability.js library (no CDN dependency).
 */
export class ReadabilityExtractorTool implements Tool<ReadabilityExtractorArgs, ReadabilityExtractorResult> {
  name = 'readability_extractor';
  description = 'Extracts the main article content from a webpage using Mozilla Readability library. Returns plain text content, removing ads, navigation, and other distracting elements. Does not require LLM calls. Uses bundled library with no external dependencies.';

  schema = {
    type: 'object',
    properties: {
      instruction: {
        type: 'string',
        description: 'Optional natural language instruction for context'
      },
      reasoning: {
        type: 'string',
        description: 'Reasoning about the extraction process displayed to the user'
      }
    },
    required: ['reasoning']
  };

  /**
   * Execute the Readability extraction with automatic LLM fallback
   */
  async execute(args: ReadabilityExtractorArgs, ctx?: LLMContext): Promise<ReadabilityExtractorResult> {
    logger.info('Executing with args', { args });
    const READINESS_TIMEOUT_MS = 15000; // 15 seconds timeout for page readiness

    try {
      // Ensure SDK is available
      if (!(await ensureSDK()) || !SDK) {
        return {
          success: false,
          textContent: null,
          error: 'SDK not available (Node.js environment)'
        };
      }

      // Wait for page load
      const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
      if (!target) {
        throw new Error('No page target available');
      }

      try {
        logger.debug('Waiting for page to be ready...');
        await waitForPageLoad(target, READINESS_TIMEOUT_MS);
        logger.debug('Page is ready');
      } catch (error) {
        logger.warn('Page readiness timeout, proceeding anyway', { error });
      }

      // Run extraction in the page context using bundled Readability
      logger.debug('Running Readability extraction in page context...');

      // Escape the bundled source for injection
      const escapedSource = READABILITY_SOURCE.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

      const extractionExpression = `
        (function() {
          try {
            // Inject Readability library if not already loaded
            if (typeof Readability === 'undefined') {
              eval(\`${escapedSource}\`);
            }

            // Verify Readability is now available
            if (typeof Readability === 'undefined') {
              return { error: 'Readability library failed to load' };
            }

            // Create Trusted Types policy to allow Readability to use innerHTML
            // This is required in Chromium-based browsers with Trusted Types enabled
            if (window.trustedTypes && window.trustedTypes.createPolicy) {
              try {
                if (!window.trustedTypes.defaultPolicy) {
                  window.trustedTypes.createPolicy('default', {
                    createHTML: (string) => string,
                    createScript: (string) => string,
                    createScriptURL: (string) => string
                  });
                }
              } catch (policyError) {
                // Policy might already exist or creation might be blocked
                // Continue anyway as Readability might still work
              }
            }

            // Clone the document and parse with Readability
            const documentClone = document.cloneNode(true);
            const reader = new Readability(documentClone);
            const article = reader.parse();

            // Check if parsing was successful
            if (!article) {
              return { error: 'Readability could not parse this page - may not be an article' };
            }

            // Return the parsed article data
            return {
              title: article.title || '',
              textContent: article.textContent || '',
              byline: article.byline || '',
              excerpt: article.excerpt || '',
              siteName: article.siteName || ''
            };
          } catch (error) {
            return { error: error.message };
          }
        })()
      `;

      const readabilityResult = await target.runtimeAgent().invoke_evaluate({
        expression: extractionExpression,
        returnByValue: true
      });

      if (!readabilityResult || readabilityResult.exceptionDetails) {
        throw new Error(`Readability extraction failed: ${readabilityResult?.exceptionDetails?.text || 'Unknown error'}`);
      }

      const result = readabilityResult.result?.value as any;

      if (result.error) {
        throw new Error(`Readability extraction error: ${result.error}`);
      }

      // Check if content is sufficient
      const contentLength = result.textContent?.length || 0;
      const isContentSufficient = contentLength >= MIN_CONTENT_LENGTH;

      if (!isContentSufficient) {
        logger.warn(`Readability content insufficient (${contentLength} chars < ${MIN_CONTENT_LENGTH}), falling back to LLM`);

        try {
          const htmlToMarkdownTool = new HTMLToMarkdownTool();
          const llmResult = await htmlToMarkdownTool.execute({
            instruction: args.instruction || 'Extract the main content focusing on article text, headings, and important information. Remove ads, navigation, and distracting elements.',
            reasoning: args.reasoning
          }, ctx);

          if (llmResult.success && llmResult.markdownContent) {
            const llmContentLength = llmResult.markdownContent.length;
            logger.info(`LLM fallback successful (${llmContentLength} chars)`);

            return {
              success: true,
              textContent: llmResult.markdownContent,
              title: result.title,  // Keep Readability metadata if available
              byline: result.byline,
              excerpt: result.excerpt,
              siteName: result.siteName
            };
          } else {
            logger.warn('LLM fallback also failed, returning original Readability result');
          }
        } catch (llmError) {
          logger.error('LLM fallback error', { error: llmError });
          // Continue and return Readability result below
        }
      }

      // Return Readability result (either successful or best effort)
      if (!result.textContent) {
        logger.warn('Readability returned no content and LLM fallback unavailable/failed');
        return {
          success: false,
          textContent: null,
          error: 'Failed to extract content from page - no readable content found'
        };
      }

      logger.info('Extraction successful', {
        titleLength: result.title?.length || 0,
        contentLength: result.textContent?.length || 0,
        method: isContentSufficient ? 'readability' : 'readability-insufficient'
      });

      return {
        success: true,
        textContent: result.textContent,
        title: result.title,
        byline: result.byline,
        excerpt: result.excerpt,
        siteName: result.siteName
      };

    } catch (error) {
      logger.error('Extraction failed', { error });
      return {
        success: false,
        textContent: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
