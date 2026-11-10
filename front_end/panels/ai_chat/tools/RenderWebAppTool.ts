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

const logger = createLogger('RenderWebAppTool');

/**
 * Arguments for webapp rendering
 */
export interface RenderWebAppArgs {
  html: string;
  css?: string;
  js?: string;
  reasoning: string;
}

/**
 * Result of webapp rendering
 */
export interface RenderWebAppResult {
  success: boolean;
  webappId: string;
  message: string;
}

/**
 * Tool for rendering a full-screen webapp using an iframe
 * This enables AI agents to render dynamic UI applications (forms, dialogs, interactive apps)
 * in an isolated full-screen iframe for user interaction and data collection.
 */
export class RenderWebAppTool implements Tool<RenderWebAppArgs, RenderWebAppResult | ErrorResult> {
  name = 'render_webapp';
  description = 'Renders a full-screen webapp in an isolated iframe. Creates an interactive application with HTML, CSS, and JavaScript for collecting user data or showing dynamic content. The webapp runs in a sandboxed iframe with full viewport coverage. Returns a unique webappId for later data retrieval and cleanup.';

  async execute(args: RenderWebAppArgs, _ctx?: LLMContext): Promise<RenderWebAppResult | ErrorResult> {
    logger.info('Rendering webapp', {
      htmlLength: args.html.length,
      hasCss: !!args.css,
      hasJs: !!args.js,
      reasoning: args.reasoning
    });

    const { html, css, js, reasoning } = args;

    // Validate required arguments
    if (!html || typeof html !== 'string') {
      return { error: 'HTML content is required and must be a string' };
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

    // Navigate to blank page first for clean canvas
    logger.info('Navigating to blank page before rendering webapp');
    const pageAgent = target.pageAgent();
    if (pageAgent) {
      try {
        const navResult = await pageAgent.invoke_navigate({ url: 'about:blank' });
        if (navResult.getError()) {
          logger.warn(`Navigation to blank page failed: ${navResult.getError()}, continuing anyway`);
        } else {
          // Wait briefly for blank page to load (should be instant)
          await new Promise(resolve => setTimeout(resolve, 300));
          logger.info('Navigated to blank page successfully');
        }
      } catch (navError) {
        logger.warn('Error navigating to blank page, continuing anyway:', navError);
      }
    }

    try {
      const runtimeAgent = target.runtimeAgent();

      // Execute webapp rendering script in page context
      const result = await runtimeAgent.invoke_evaluate({
        expression: `
          (() => {
            // Generate unique webapp ID
            const webappId = 'devtools-webapp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

            // Create full-screen iframe
            const iframe = document.createElement('iframe');
            iframe.id = webappId;
            iframe.setAttribute('data-devtools-webapp', 'true');
            iframe.setAttribute('data-reasoning', ${JSON.stringify(reasoning)});

            // Style iframe for full-screen coverage
            iframe.style.position = 'fixed';
            iframe.style.top = '0';
            iframe.style.left = '0';
            iframe.style.width = '100vw';
            iframe.style.height = '100vh';
            iframe.style.border = 'none';
            iframe.style.zIndex = '999999';
            iframe.style.backgroundColor = 'white';

            // Build complete HTML document for iframe
            const fullHTML = '<!DOCTYPE html>' +
              '<html>' +
              '<head>' +
              '<meta charset="UTF-8">' +
              '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
              (${JSON.stringify(css || '')} ? '<style>' + ${JSON.stringify(css || '')} + '</style>' : '') +
              '</head>' +
              '<body>' +
              ${JSON.stringify(html)} +
              '</body>' +
              '</html>';

            // Set iframe content using srcdoc
            iframe.srcdoc = fullHTML;

            // Append iframe to body
            document.body.appendChild(iframe);

            // Wait for iframe to load, then inject JavaScript and submit detection
            iframe.addEventListener('load', function() {
              try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

                // Inject JavaScript with automatic submit detection
                const script = iframeDoc.createElement('script');
                script.setAttribute('data-devtools-injected', 'true');

                // Build script content
                let scriptContent = '(function() {';

                // Add automatic submit detection for forms
                scriptContent += 'const forms = document.querySelectorAll("form");';
                scriptContent += 'forms.forEach(function(form) {';
                scriptContent += '  form.addEventListener("submit", function(e) {';
                scriptContent += '    e.preventDefault();';
                scriptContent += '    document.body.setAttribute("data-submitted", "true");';
                scriptContent += '    document.body.setAttribute("data-submit-time", Date.now().toString());';
                scriptContent += '  });';
                scriptContent += '});';

                // Add button click detection as fallback
                scriptContent += 'const buttons = document.querySelectorAll("button");';
                scriptContent += 'buttons.forEach(function(btn) {';
                scriptContent += '  if (btn.type === "submit" || btn.textContent.toLowerCase().includes("submit")) {';
                scriptContent += '    btn.addEventListener("click", function(e) {';
                scriptContent += '      setTimeout(function() {';
                scriptContent += '        document.body.setAttribute("data-submitted", "true");';
                scriptContent += '        document.body.setAttribute("data-submit-time", Date.now().toString());';
                scriptContent += '      }, 100);';
                scriptContent += '    });';
                scriptContent += '  }';
                scriptContent += '});';

                // Add custom JavaScript if provided
                if (${JSON.stringify(js || '')}) {
                  scriptContent += 'try {';
                  scriptContent += ${JSON.stringify(js || '')};
                  scriptContent += '} catch (error) {';
                  scriptContent += '  console.error("Error in custom webapp script:", error);';
                  scriptContent += '}';
                }

                scriptContent += '})();';
                script.textContent = scriptContent;
                iframeDoc.body.appendChild(script);
              } catch (scriptError) {
                console.error('Failed to inject script into iframe:', scriptError);
              }
            });

            return {
              success: true,
              webappId: webappId,
              message: 'Webapp rendered successfully in full-screen iframe'
            };
          })()
        `,
        returnByValue: true,
      });

      // Check for evaluation errors
      if (result.exceptionDetails) {
        const errorMsg = result.exceptionDetails.text || 'Unknown evaluation error';
        logger.error('Webapp rendering failed with exception:', errorMsg);
        return { error: `Webapp rendering failed: ${errorMsg}` };
      }

      // Extract result
      const renderResult = result.result.value as RenderWebAppResult;

      if (!renderResult || !renderResult.success) {
        logger.error('Webapp rendering script returned unsuccessful result');
        return { error: 'Webapp rendering script failed to execute properly' };
      }

      logger.info('Successfully rendered webapp', {
        webappId: renderResult.webappId
      });

      return renderResult;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to render webapp:', errorMsg);
      return { error: `Failed to render webapp: ${errorMsg}` };
    }
  }

  schema = {
    type: 'object',
    properties: {
      html: {
        type: 'string',
        description: 'The HTML content for the webapp body (e.g., form, dialog, interactive UI). Will be inserted into the iframe body.',
      },
      css: {
        type: 'string',
        description: 'Optional CSS styles for the webapp. Will be added to the iframe head as a <style> element.',
      },
      js: {
        type: 'string',
        description: 'Optional JavaScript code for interactive behavior. The code runs in the iframe context with access to the iframe\'s document.',
      },
      reasoning: {
        type: 'string',
        description: 'Required explanation for why this webapp is being rendered (e.g., "Creating email collection form for newsletter signup")',
      },
    },
    required: ['html', 'reasoning'],
  };
}
