// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../core/Logger.js';
import type { Tool, LLMContext } from './Tools.js';
import { getAdapter } from '../cdp/getAdapter.js';

const logger = createLogger('Tool:ExecuteCode');

/**
 * Arguments for code execution
 */
export interface ExecuteCodeArgs {
  code: string;
  reasoning: string;
}

/**
 * Tool for executing arbitrary JavaScript code in the page context
 * Useful for extracting data, getting links, running custom logic, etc.
 */
export class ExecuteCodeTool implements Tool<ExecuteCodeArgs, any> {
  name = 'execute_code';
  description = `Executes JavaScript code in the current page context and returns the raw result.

Use this tool when you need to:
- Extract all links from the page: Array.from(document.links).map(a => ({text: a.textContent.trim(), href: a.href}))
- Get specific DOM elements with custom logic: document.querySelectorAll('.item').map(el => ({...}))
- Extract table data: Array.from(document.querySelectorAll('table tr')).map(row => [...])
- Get computed styles: window.getComputedStyle(document.querySelector('.target'))
- Run custom JavaScript that doesn't fit schema-based extraction
- Check page state: document.readyState, window.location, etc.
- Extract images: Array.from(document.images).map(img => ({src: img.src, alt: img.alt}))
- Get metadata: {title: document.title, url: window.location.href, description: document.querySelector('meta[name="description"]')?.content}

The code executes in the page's JavaScript context with full DOM API access.
The raw JavaScript return value is returned directly without any parsing or wrapping.

IMPORTANT:
- The code should be a valid JavaScript expression or IIFE
- Use arrow functions or IIFEs for multi-line code: (() => { /* code */ })()
- Return values must be JSON-serializable (strings, numbers, objects, arrays)
- DOM nodes cannot be returned directly - extract their properties instead
- Avoid side effects unless intentional (e.g., modifying the page)
- The result is returned exactly as JavaScript produces it (no wrapper objects)

Examples:
• Get all links: Array.from(document.links).map(a => ({text: a.textContent.trim(), href: a.href}))
• Extract product data: Array.from(document.querySelectorAll('.product')).map(p => ({name: p.querySelector('.name').textContent, price: p.querySelector('.price').textContent}))
• Get page metadata: ({title: document.title, url: location.href, images: document.images.length})
• Check element existence: !!document.querySelector('#login-button')
• Get all headings: Array.from(document.querySelectorAll('h1, h2, h3')).map(h => ({level: h.tagName, text: h.textContent.trim()}))`;

  schema = {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript code to execute in the page context. Must be a valid expression or IIFE that returns a value.'
      },
      reasoning: {
        type: 'string',
        description: 'Explanation of what this code does and why you are executing it (shown to user)'
      }
    },
    required: ['code', 'reasoning']
  };

  async execute(args: ExecuteCodeArgs, ctx?: LLMContext): Promise<any> {
    const { code, reasoning } = args;

    if (typeof code !== 'string' || code.trim().length === 0) {
      return { error: 'Code must be a non-empty string' };
    }

    logger.info(`Executing code with reasoning: ${reasoning}`);
    logger.debug(`Code to execute: ${code.substring(0, 200)}${code.length > 200 ? '...' : ''}`);

    // Get adapter from context (works in both DevTools and eval runner)
    const adapter = await getAdapter(ctx);
    if (!adapter) {
      return { error: 'No browser connection available' };
    }

    try {
      // Execute the code in the page context
      const runtimeAgent = adapter.runtimeAgent();
      const result = await runtimeAgent.invoke<{
        result?: { value?: any; type?: string };
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      }>('evaluate', {
        expression: code,
        returnByValue: true, // Return the actual value, not a remote object reference
        awaitPromise: true,  // Wait for promises to resolve
        timeout: 10000,      // 10 second timeout
      });

      // Check for exceptions
      if (result.exceptionDetails) {
        const errorMessage = result.exceptionDetails.text || 'Unknown error';
        const errorStack = result.exceptionDetails.exception?.description || '';

        logger.error(`Code execution failed: ${errorMessage}`);
        logger.debug(`Exception details:`, result.exceptionDetails);

        return {
          error: errorMessage,
          exceptionDetails: errorStack
        };
      }

      // Return the raw result value directly
      const resultValue = result.result?.value;
      logger.info(`Code executed successfully, result type: ${result.result?.type}`);
      logger.debug(`Result preview: ${JSON.stringify(resultValue).substring(0, 200)}...`);

      return resultValue;

    } catch (error) {
      logger.error('Error executing code:', error);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
