// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../../core/Logger.js';
import type { CDPSessionAdapter } from '../../cdp/CDPSessionAdapter.js';
import { parseEncodedId } from '../../common/context.js';
import { FrameRegistryUniversal } from '../../cdp/FrameRegistryUniversal.js';
import type { ElementAttributes, CacheLookupResult } from './types.js';
import { ActionPatternCache } from './ActionPatternCache.js';

const logger = createLogger('ActionPatternCapture');

/**
 * Captures XPath and attributes from elements after successful actions.
 * Also resolves elements from cached XPaths.
 */
export class ActionPatternCapture {
  private readonly adapter: CDPSessionAdapter;
  private readonly cache: ActionPatternCache;

  constructor(adapter: CDPSessionAdapter) {
    this.adapter = adapter;
    this.cache = ActionPatternCache.getInstance();
  }

  /**
   * Extract XPath and attributes from an element after successful action
   */
  async capturePattern(
    encodedId: string,
    url: string,
    semanticIntent: string
  ): Promise<boolean> {
    try {
      const { xpath, cssSelector, attributes } = await this.extractElementInfo(encodedId);

      if (!xpath) {
        logger.warn('Could not extract XPath for', encodedId);
        return false;
      }

      await this.cache.save(url, semanticIntent, xpath, attributes, cssSelector || undefined);
      logger.info('Captured action pattern', { url, semanticIntent, xpath });
      return true;
    } catch (error) {
      logger.error('Failed to capture pattern:', error);
      return false;
    }
  }

  /**
   * Look up element using cached XPath
   */
  async lookupFromCache(
    url: string,
    semanticIntent: string
  ): Promise<CacheLookupResult> {
    const cacheKey = this.cache.generateCacheKey(url, semanticIntent);
    const pattern = await this.cache.get(cacheKey);

    if (!pattern) {
      return { found: false };
    }

    try {
      // Try to find element using cached XPath
      const encodedId = await this.findElementByXPath(pattern.xpath);

      if (encodedId) {
        // Validate element is still valid (visible, enabled)
        const isValid = await this.validateElement(encodedId);
        if (isValid) {
          return {
            found: true,
            pattern,
            encodedId,
            xpathSuccess: true,
          };
        }
      }

      // XPath failed, try CSS selector as fallback
      if (pattern.cssSelector) {
        const fallbackId = await this.findElementByCssSelector(pattern.cssSelector);
        if (fallbackId) {
          const isValid = await this.validateElement(fallbackId);
          if (isValid) {
            return {
              found: true,
              pattern,
              encodedId: fallbackId,
              xpathSuccess: false, // XPath failed but CSS worked
            };
          }
        }
      }

      // Both methods failed
      await this.cache.recordFailure(cacheKey);
      return {
        found: true,
        pattern,
        xpathSuccess: false,
        error: 'Element not found with cached XPath or CSS selector',
      };
    } catch (error) {
      logger.error('Cache lookup error:', error);
      return {
        found: true,
        pattern,
        xpathSuccess: false,
        error: String(error),
      };
    }
  }

  /**
   * Extract XPath, CSS selector, and attributes from an element
   */
  private async extractElementInfo(encodedId: string): Promise<{
    xpath: string | null;
    cssSelector: string | null;
    attributes: ElementAttributes;
  }> {
    const parsed = parseEncodedId(encodedId);
    if (!parsed) {
      return { xpath: null, cssSelector: null, attributes: {} };
    }

    const { frameOrdinal, backendNodeId } = parsed;

    try {
      const domAgent = this.adapter.domAgent();
      const runtimeAgent = this.adapter.runtimeAgent();

      // Get execution context for the frame
      let executionContextId: number | undefined;
      if (frameOrdinal > 0) {
        const frameRegistry = new FrameRegistryUniversal(this.adapter);
        await frameRegistry.collectFrames();
        const frameInfo = frameRegistry.getFrameByOrdinal(frameOrdinal);
        if (frameInfo) {
          executionContextId = await this.getFrameExecutionContextId(frameInfo.frameId);
        }
      }

      // Resolve the node to get objectId
      const resolveResponse = await domAgent.invoke<{
        object?: { objectId?: string };
      }>('resolveNode', {
        backendNodeId,
        executionContextId,
      });

      if (!resolveResponse.object?.objectId) {
        return { xpath: null, cssSelector: null, attributes: {} };
      }

      const objectId = resolveResponse.object.objectId;

      // Extract all info in one call
      const result = await runtimeAgent.invoke<{
        result?: { value?: {
          xpath: string;
          cssSelector: string;
          idAttr: string | null;
          nameAttr: string | null;
          ariaLabel: string | null;
          placeholder: string | null;
          inputType: string | null;
          tagName: string | null;
          role: string | null;
          textContent: string | null;
        } };
      }>('callFunctionOn', {
        objectId,
        functionDeclaration: `
          function() {
            const el = this;

            // Generate XPath
            function getXPath(element) {
              if (!element) return '';

              // Prefer ID-based XPath (most stable)
              if (element.id) {
                return '//*[@id="' + element.id + '"]';
              }

              // Try name attribute for form elements
              if (element.name && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(element.tagName)) {
                const tag = element.tagName.toLowerCase();
                return '//' + tag + '[@name="' + element.name + '"]';
              }

              // Try aria-label
              const ariaLabel = element.getAttribute('aria-label');
              if (ariaLabel) {
                return '//*[@aria-label="' + ariaLabel + '"]';
              }

              // Fall back to positional XPath
              if (element === document.body) return '/html/body';

              let ix = 0;
              const siblings = element.parentNode?.children || [];
              for (let i = 0; i < siblings.length; i++) {
                const sibling = siblings[i];
                if (sibling === element) {
                  const tag = element.tagName.toLowerCase();
                  const parentPath = getXPath(element.parentNode);
                  return parentPath + '/' + tag + '[' + (ix + 1) + ']';
                }
                if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
                  ix++;
                }
              }
              return '';
            }

            // Generate CSS selector
            function getCssSelector(element) {
              if (!element) return '';
              const tag = element.tagName.toLowerCase();
              if (element.id) {
                return tag + '#' + element.id;
              }
              if (element.name) {
                return tag + '[name="' + element.name + '"]';
              }
              if (element.className && typeof element.className === 'string') {
                const classes = element.className.trim().split(/\\s+/).slice(0, 2).join('.');
                if (classes) return tag + '.' + classes;
              }
              return tag;
            }

            // Get text content (trimmed, first 50 chars)
            let textContent = (el.textContent || '').trim().substring(0, 50);
            if (textContent.length === 50) textContent += '...';

            return {
              xpath: getXPath(el),
              cssSelector: getCssSelector(el),
              idAttr: el.id || null,
              nameAttr: el.name || null,
              ariaLabel: el.getAttribute('aria-label') || null,
              placeholder: el.placeholder || null,
              inputType: el.type || null,
              tagName: el.tagName?.toLowerCase() || null,
              role: el.getAttribute('role') || null,
              textContent: textContent || null,
            };
          }
        `,
        returnByValue: true,
        executionContextId,
      });

      if (!result.result?.value) {
        return { xpath: null, cssSelector: null, attributes: {} };
      }

      const info = result.result.value;

      const attributes: ElementAttributes = {};
      if (info.idAttr) attributes.idAttr = info.idAttr;
      if (info.nameAttr) attributes.nameAttr = info.nameAttr;
      if (info.ariaLabel) attributes.ariaLabel = info.ariaLabel;
      if (info.placeholder) attributes.placeholder = info.placeholder;
      if (info.inputType) attributes.inputType = info.inputType;
      if (info.tagName) attributes.tagName = info.tagName;
      if (info.role) attributes.role = info.role;
      if (info.textContent) attributes.textContent = info.textContent;

      return {
        xpath: info.xpath || null,
        cssSelector: info.cssSelector || null,
        attributes,
      };
    } catch (error) {
      logger.error('Error extracting element info:', error);
      return { xpath: null, cssSelector: null, attributes: {} };
    }
  }

  /**
   * Find element by XPath and return its EncodedId
   */
  private async findElementByXPath(xpath: string): Promise<string | null> {
    try {
      const runtimeAgent = this.adapter.runtimeAgent();
      const domAgent = this.adapter.domAgent();

      // Evaluate XPath to find element
      const evalResult = await runtimeAgent.invoke<{
        result?: { objectId?: string };
        exceptionDetails?: unknown;
      }>('evaluate', {
        expression: `
          (function() {
            const result = document.evaluate(
              ${JSON.stringify(xpath)},
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            );
            return result.singleNodeValue;
          })()
        `,
        returnByValue: false,
      });

      if (!evalResult.result?.objectId) {
        return null;
      }

      // Get backendNodeId from objectId
      const nodeResult = await domAgent.invoke<{
        nodeId?: number;
        node?: { backendNodeId?: number };
      }>('describeNode', {
        objectId: evalResult.result.objectId,
      });

      const backendNodeId = nodeResult.node?.backendNodeId;
      if (!backendNodeId) {
        return null;
      }

      // Return EncodedId (frame 0 for main frame)
      return `0-${backendNodeId}`;
    } catch (error) {
      logger.debug('XPath lookup failed:', error);
      return null;
    }
  }

  /**
   * Find element by CSS selector and return its EncodedId
   */
  private async findElementByCssSelector(selector: string): Promise<string | null> {
    try {
      const runtimeAgent = this.adapter.runtimeAgent();
      const domAgent = this.adapter.domAgent();

      const evalResult = await runtimeAgent.invoke<{
        result?: { objectId?: string };
      }>('evaluate', {
        expression: `document.querySelector(${JSON.stringify(selector)})`,
        returnByValue: false,
      });

      if (!evalResult.result?.objectId) {
        return null;
      }

      const nodeResult = await domAgent.invoke<{
        node?: { backendNodeId?: number };
      }>('describeNode', {
        objectId: evalResult.result.objectId,
      });

      const backendNodeId = nodeResult.node?.backendNodeId;
      if (!backendNodeId) {
        return null;
      }

      return `0-${backendNodeId}`;
    } catch (error) {
      logger.debug('CSS selector lookup failed:', error);
      return null;
    }
  }

  /**
   * Validate that an element is visible and enabled
   */
  private async validateElement(encodedId: string): Promise<boolean> {
    const parsed = parseEncodedId(encodedId);
    if (!parsed) return false;

    try {
      const domAgent = this.adapter.domAgent();
      const runtimeAgent = this.adapter.runtimeAgent();

      const resolveResponse = await domAgent.invoke<{
        object?: { objectId?: string };
      }>('resolveNode', {
        backendNodeId: parsed.backendNodeId,
      });

      if (!resolveResponse.object?.objectId) {
        return false;
      }

      const result = await runtimeAgent.invoke<{
        result?: { value?: { visible: boolean; enabled: boolean } };
      }>('callFunctionOn', {
        objectId: resolveResponse.object.objectId,
        functionDeclaration: `
          function() {
            const el = this;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);

            const visible = rect.width > 0 && rect.height > 0 &&
                           style.visibility !== 'hidden' &&
                           style.display !== 'none' &&
                           style.opacity !== '0';

            const enabled = !el.disabled && !el.hasAttribute('aria-disabled');

            return { visible, enabled };
          }
        `,
        returnByValue: true,
      });

      const validation = result.result?.value;
      return !!(validation?.visible && validation?.enabled);
    } catch {
      return false;
    }
  }

  /**
   * Get execution context ID for a frame
   */
  private async getFrameExecutionContextId(_frameId: string): Promise<number | undefined> {
    // For now, return undefined and let the caller handle main frame
    // A proper implementation would track execution contexts via Runtime.executionContextCreated
    return undefined;
  }
}

/**
 * Singleton accessor for convenience
 */
let captureInstance: ActionPatternCapture | null = null;

export function getActionPatternCapture(adapter: CDPSessionAdapter): ActionPatternCapture {
  if (!captureInstance || (captureInstance as any).adapter !== adapter) {
    captureInstance = new ActionPatternCapture(adapter);
  }
  return captureInstance;
}
