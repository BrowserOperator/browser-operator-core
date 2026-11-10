// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../core/Logger.js';
import type { Tool, LLMContext, ErrorResult } from './Tools.js';

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

const logger = createLogger('GetWebAppDataTool');

/**
 * Arguments for retrieving webapp data
 */
export interface GetWebAppDataArgs {
  webappId: string;
  reasoning: string;
  waitForSubmit?: boolean;
  timeout?: number;
}

/**
 * Result of webapp data retrieval
 */
export interface GetWebAppDataResult {
  success: boolean;
  formData: Record<string, any>;
  message: string;
}

/**
 * Tool for retrieving data from rendered webapp iframe
 * Extracts values from input, select, textarea, checkbox, and radio elements
 * within the webapp iframe.
 */
export class GetWebAppDataTool implements Tool<GetWebAppDataArgs, GetWebAppDataResult | ErrorResult> {
  name = 'get_webapp_data';
  description = 'Retrieves data from form elements within a previously rendered webapp iframe. Can optionally wait for form submission before retrieving data. Returns an object with field names as keys and their values. Supports text inputs, emails, selects, textareas, checkboxes, and radio buttons.';

  async execute(args: GetWebAppDataArgs, _ctx?: LLMContext): Promise<GetWebAppDataResult | ErrorResult> {
    logger.info('Retrieving webapp data', {
      webappId: args.webappId,
      reasoning: args.reasoning,
      waitForSubmit: args.waitForSubmit,
      timeout: args.timeout
    });

    const { webappId, reasoning, waitForSubmit = false, timeout = 30000 } = args;

    // Validate required arguments
    if (!webappId || typeof webappId !== 'string') {
      return { error: 'webappId is required and must be a string' };
    }

    if (!reasoning || typeof reasoning !== 'string') {
      return { error: 'Reasoning is required and must be a string' };
    }

    // Get the primary page target
    if (!(await ensureSDK()) || !SDK) {
      return { error: 'SDK not available (Node.js environment)' };
    }
    const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
    if (!target) {
      logger.error('No primary page target available');
      return { error: 'No page target available' };
    }

    try {
      const runtimeAgent = target.runtimeAgent();

      // Wait for form submission if requested
      if (waitForSubmit) {
        const startTime = Date.now();
        const pollInterval = 500; // Poll every 500ms

        logger.info('Waiting for webapp form submission', { webappId, timeout });

        while (Date.now() - startTime < timeout) {
          const checkResult = await runtimeAgent.invoke_evaluate({
            expression: `
              (() => {
                const iframe = document.getElementById(${JSON.stringify(webappId)});
                if (!iframe) {
                  return { found: false };
                }
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                if (!iframeDoc) {
                  return { found: false };
                }
                return {
                  found: true,
                  submitted: iframeDoc.body.getAttribute('data-submitted') === 'true'
                };
              })()
            `,
            returnByValue: true,
          });

          const checkData = checkResult.result.value as { found: boolean; submitted?: boolean };

          if (!checkData.found) {
            logger.error('Webapp iframe not found while waiting for submission');
            return { error: `Webapp iframe not found with ID: ${webappId}` };
          }

          if (checkData.submitted) {
            logger.info('Webapp form submission detected', { webappId });
            break;
          }

          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        // Check if we timed out
        if (Date.now() - startTime >= timeout) {
          logger.warn('Timeout waiting for webapp form submission', { webappId, timeout });
          return { error: `Timeout waiting for webapp form submission after ${timeout}ms` };
        }
      }

      // Execute data extraction script in page context
      const result = await runtimeAgent.invoke_evaluate({
        expression: `
          (() => {
            // Find the webapp iframe
            const iframe = document.getElementById(${JSON.stringify(webappId)});
            if (!iframe) {
              return {
                success: false,
                error: 'Webapp iframe not found with ID: ${webappId}'
              };
            }

            // Access iframe document
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            if (!iframeDoc) {
              return {
                success: false,
                error: 'Cannot access webapp iframe content'
              };
            }

            // Collect form data
            const formData = {};

            // Find all form elements within the iframe
            const inputs = iframeDoc.querySelectorAll('input, select, textarea');

            inputs.forEach((element) => {
              // Get the field identifier (prefer name, fallback to id)
              const fieldName = element.name || element.id;

              // Skip elements without identifiers
              if (!fieldName) {
                return;
              }

              // Extract value based on element type
              if (element.tagName.toLowerCase() === 'input') {
                const inputType = element.type ? element.type.toLowerCase() : 'text';

                if (inputType === 'checkbox') {
                  // For checkboxes, check if we already have this field name
                  if (fieldName in formData) {
                    // Multiple checkboxes with same name - create array
                    if (!Array.isArray(formData[fieldName])) {
                      formData[fieldName] = [formData[fieldName]];
                    }
                    if (element.checked) {
                      formData[fieldName].push(element.value || true);
                    }
                  } else {
                    // First checkbox with this name
                    formData[fieldName] = element.checked ? (element.value || true) : false;
                  }
                } else if (inputType === 'radio') {
                  // For radio buttons, only store if checked
                  if (element.checked) {
                    formData[fieldName] = element.value || true;
                  }
                } else {
                  // Text, email, number, password, etc.
                  formData[fieldName] = element.value || '';
                }
              } else if (element.tagName.toLowerCase() === 'select') {
                // For select elements, get selected value
                if (element.multiple) {
                  // Multiple select - get array of selected values
                  const selectedOptions = Array.from(element.selectedOptions || []);
                  formData[fieldName] = selectedOptions.map(opt => opt.value);
                } else {
                  // Single select
                  formData[fieldName] = element.value || '';
                }
              } else if (element.tagName.toLowerCase() === 'textarea') {
                // For textareas
                formData[fieldName] = element.value || '';
              }
            });

            return {
              success: true,
              formData: formData,
              message: 'Webapp data retrieved successfully'
            };
          })()
        `,
        returnByValue: true,
      });

      // Check for evaluation errors
      if (result.exceptionDetails) {
        const errorMsg = result.exceptionDetails.text || 'Unknown evaluation error';
        logger.error('Webapp data retrieval failed with exception:', errorMsg);
        return { error: `Webapp data retrieval failed: ${errorMsg}` };
      }

      // Extract result
      const retrievalResult = result.result.value as GetWebAppDataResult | { success: false; error: string };

      if (!retrievalResult.success) {
        const error = 'error' in retrievalResult ? retrievalResult.error : 'Unknown error';
        logger.error('Webapp data retrieval script returned error:', error);
        return { error };
      }

      logger.info('Successfully retrieved webapp data', {
        webappId,
        fieldCount: Object.keys((retrievalResult as GetWebAppDataResult).formData).length
      });

      return retrievalResult as GetWebAppDataResult;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to retrieve webapp data:', errorMsg);
      return { error: `Failed to retrieve webapp data: ${errorMsg}` };
    }
  }

  schema = {
    type: 'object',
    properties: {
      webappId: {
        type: 'string',
        description: 'The unique webapp ID returned from the render_webapp tool. Used to identify which webapp to retrieve data from.',
      },
      reasoning: {
        type: 'string',
        description: 'Required explanation for why this data is being retrieved (e.g., "Collecting submitted user information")',
      },
      waitForSubmit: {
        type: 'boolean',
        description: 'If true, waits for form submission before retrieving data. The tool will poll until the form is submitted or timeout is reached. Default: false',
      },
      timeout: {
        type: 'number',
        description: 'Maximum time to wait for form submission in milliseconds. Only used when waitForSubmit is true. Default: 30000 (30 seconds)',
      },
    },
    required: ['webappId', 'reasoning'],
  };
}
