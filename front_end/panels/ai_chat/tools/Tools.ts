// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type * as Protocol from "../../../generated/protocol.js";
import { createLogger } from "../core/Logger.js";
import {
  getAdapter,
  preloadBrowserDeps,
  type AdapterContext,
} from "../cdp/getAdapter.js";
import type { CDPSessionAdapter } from "../cdp/CDPSessionAdapter.js";
import {
  isEncodedId,
  parseEncodedId,
  type EncodedId,
} from "../common/context.js";
import { ResolveEncodedIdTool } from "./HybridAccessibilityTreeTool.js";
import {
  captureHybridSnapshotUniversal,
  type HybridSnapshot,
} from "../a11y/HybridSnapshotUniversal.js";
import {
  searchAccessibilityTree as searchAccessibilityTreeImpl,
  type ScoredSearchMatch,
} from "../common/accessibility-tree-search.js";

const logger = createLogger("Tools");

// Detect if we're in a Node.js environment (eval runner, tests)
const isNodeEnvironment =
  typeof window === "undefined" || typeof document === "undefined";

// Lazy-loaded browser-only dependencies
let SDK: typeof import("../../../core/sdk/sdk.js") | null = null;
let Common: typeof import("../../../core/common/common.js") | null = null;
let Logs: typeof import("../../../models/logs/logs.js") | null = null;
let Utils: typeof import("../common/utils.js") | null = null;
let AgentService: typeof import("../core/AgentService.js").AgentService | null =
  null;
let browserDepsLoaded = false;

/**
 * Ensures browser dependencies (SDK, Common, Logs, Utils) are loaded.
 * Returns false in Node.js environment or if loading fails.
 */
async function ensureToolsBrowserDeps(): Promise<boolean> {
  if (isNodeEnvironment) {
    return false;
  }
  if (!browserDepsLoaded) {
    browserDepsLoaded = true;
    try {
      // Also ensure the CDP adapter deps are loaded
      await preloadBrowserDeps();
      const [
        sdkModule,
        commonModule,
        logsModule,
        utilsModule,
        agentServiceModule,
      ] = await Promise.all([
        import("../../../core/sdk/sdk.js"),
        import("../../../core/common/common.js"),
        import("../../../models/logs/logs.js"),
        import("../common/utils.js"),
        import("../core/AgentService.js"),
      ]);
      SDK = sdkModule;
      Common = commonModule;
      Logs = logsModule;
      Utils = utilsModule;
      AgentService = agentServiceModule.AgentService;
    } catch {
      return false;
    }
  }
  return SDK !== null;
}

// Value imports first, then types, ordered correctly
import type { AccessibilityNode } from "../common/context.js";
import type { LogLine } from "../common/log.js";
import * as UtilsUniversal from "../common/utils-universal.js";
// Note: Utils is now lazy-loaded above for browser/Node.js portability
// Use UtilsUniversal for adapter-compatible functions that work in both environments
import type { DevToolsContext } from "../core/State.js";
import { LLMClient } from "../LLM/LLMClient.js";
import type { LLMProvider } from "../LLM/LLMTypes.js";
import { ChatMessageEntity } from "../models/ChatTypes.js";

// Type imports

import {
  CombinedExtractionTool,
  type CombinedExtractionResult,
} from "./CombinedExtractionTool.js";
import {
  FetcherTool,
  type FetcherToolResult,
  type FetcherToolArgs,
} from "./FetcherTool.js";
import {
  FinalizeWithCritiqueTool,
  type FinalizeWithCritiqueResult,
} from "./FinalizeWithCritiqueTool.js";
import {
  FullPageAccessibilityTreeToMarkdownTool,
  type FullPageAccessibilityTreeToMarkdownResult,
} from "./FullPageAccessibilityTreeToMarkdownTool.js";
import {
  HTMLToMarkdownTool,
  type HTMLToMarkdownResult,
} from "./HTMLToMarkdownTool.js";
import {
  SchemaBasedExtractorTool,
  type SchemaExtractionResult,
  type SchemaDefinition,
} from "./SchemaBasedExtractorTool.js";
import { VisitHistoryManager, type VisitData } from "./VisitHistoryManager.js";
import {
  SequentialThinkingTool,
  type SequentialThinkingResult,
  type SequentialThinkingArgs,
  type ExecutedStep,
} from "./SequentialThinkingTool.js";
import {
  RenderWebAppTool,
  type RenderWebAppArgs,
  type RenderWebAppResult,
} from "./RenderWebAppTool.js";
import {
  GetWebAppDataTool,
  type GetWebAppDataArgs,
  type GetWebAppDataResult,
} from "./GetWebAppDataTool.js";
import {
  RemoveWebAppTool,
  type RemoveWebAppArgs,
  type RemoveWebAppResult,
} from "./RemoveWebAppTool.js";
import { ContentChunker } from "../utils/ContentChunker.js";

/**
 * Base interface for all tools
 */
export interface Tool<TArgs = Record<string, unknown>, TResult = unknown> {
  name: string;
  description: string;
  execute: (args: TArgs, ctx?: LLMContext) => Promise<TResult>;
  schema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Context passed into tools for LLM-related choices without relying on UI.
 * Extends AdapterContext to allow passing a CDP adapter for eval runner compatibility.
 */
export interface LLMContext extends AdapterContext {
  apiKey?: string;
  provider: LLMProvider;
  model: string;
  getVisionCapability?: (model: string) => Promise<boolean> | boolean;
  miniModel?: string;
  nanoModel?: string;
  abortSignal?: AbortSignal;
  /** If true, don't emit UI progress events (for background tools/agents) */
  background?: boolean;
}

/**
 * Type for element inspection result
 */
export interface ElementInspectionResult {
  found: boolean;
  tagName?: string;
  id?: string;
  classList?: string[];
  attributes?: Record<string, string>;
  boundingRect?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
  };
  styles?: Record<string, string>;
}

/**
 * Type for JavaScript execution result
 */
export interface JavaScriptExecutionResult {
  result: unknown;
  type: string;
  exceptionDetails?: unknown;
}

/**
 * Type for console logs result
 */
export interface ConsoleLogsResult {
  messages: Array<{
    text: string;
    level: string;
    timestamp: number;
    url?: string;
    lineNumber?: number;
  }>;
  total: number;
}

/**
 * Type for error result
 */
export interface ErrorResult {
  error: string;
}

/**
 * Type for network analysis result
 */
export interface NetworkAnalysisResult {
  requests: Array<{
    url: string;
    method: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    response: {
      headers: Record<string, string>;
      body: string;
    };
  }>;
}

/**
 * Type for navigation result
 */
export interface NavigationResult {
  url: string;
  message: string;
  metadata?: { url: string; title: string };
}

/**
 * Type for page HTML result
 */
export interface PageHTMLResult {
  html: string;
  documentTitle: string;
  url: string;
  metadata?: {
    description?: string;
    keywords?: string;
    author?: string;
    [key: string]: string | undefined;
  };
  structure?: {
    headings: Array<{ level: number; text: string }>;
    mainContent?: string;
    navigation?: string;
  };
}

/**
 * Type for click element result
 */
export interface ClickElementResult {
  message: string;
  elementInfo?: {
    tagName: string;
    text?: string;
    href?: string;
  };
}

/**
 * Type for search content result
 */
export interface SearchContentResult {
  matches: Array<{
    text: string;
    context: string;
    elementInfo: {
      tagName: string;
      selector: string;
    };
  }>;
  totalMatches: number;
}

/**
 * Type for scroll result
 */
export interface ScrollResult {
  success: boolean;
  message: string;
  position?: {
    x: number;
    y: number;
  };
  viewportHeight?: number; // Height of the viewport in pixels
  scrollHeight?: number; // Total scrollable height of the document
  scrolledPages?: number; // Number of pages scrolled (if using pages parameter)
}

/**
 * Type for screenshot result
 */
/**
 * Interface for tool results that can include image data
 */
export interface ImageToolResult {
  imageData?: string; // Base64 data URL for sending to LLM
  error?: string;
}

/**
 * Result type for screenshot operations
 */
export interface ScreenshotResult extends ImageToolResult {
  // Inherits success, message, imageData, error from ImageToolResult
}

/**
 * Type for accessibility tree result
 */
export interface AccessibilityTreeResult {
  simplified: string;
  iframes?: Array<{
    role: string;
    nodeId?: string;
    contentTree?: Array<{
      role: string;
      name?: string;
      description?: string;
      nodeId?: string;
      children?: any[];
    }>;
    contentSimplified?: string;
  }>;
  /**
   * Raw accessibility nodes from the tree for direct node manipulation
   */
  nodes?: Protocol.Accessibility.AXNode[];
  /**
   * Mapping of nodeId to URL for nodes that have URLs
   */
  idToUrl?: Record<string, string>;
  /**
   * Mapping of backendNodeId to xpath
   */
  xpathMap?: Record<number, string>;
  /**
   * Mapping of backendNodeId to tagName
   */
  tagNameMap?: Record<number, string>;
}

/**
 * Element state verification result - returned after state-changing actions
 * to confirm the action actually succeeded.
 */
export interface ElementStateVerification {
  /** Whether verification was performed */
  verified: boolean;
  /** The action method that was performed */
  actionMethod: string;
  /** Current state of the element after action */
  currentState?: {
    /** For checkbox/radio: whether element is checked */
    checked?: boolean;
    /** For input/textarea: current value */
    value?: string;
    /** For select: currently selected option text */
    selectedOption?: string;
    /** For select: currently selected option value */
    selectedValue?: string;
    /** Element type (checkbox, radio, text, select, etc.) */
    elementType?: string;
  };
  /** Whether the state matches expected outcome */
  stateConfirmed: boolean;
  /** Human-readable summary of verification */
  summary: string;
}

/**
 * Type for perform action result
 */
export interface PerformActionResult extends ImageToolResult {
  xpath: string;
  pageChange: {
    hasChanges: boolean;
    summary: string;
    added: string[];
    removed: string[];
    modified: string[];
    hasMore: {
      added: boolean;
      removed: boolean;
      modified: boolean;
    };
  };
  visualCheck?: string; // LLM's assessment of success
  /** Element state verification for state-changing actions (check, fill, select, etc.) */
  stateVerification?: ElementStateVerification;
}

/**
 * Result type for the new tool
 */
export interface ObjectiveDrivenActionResult {
  success: boolean;
  message: string;
  finalAction?: {
    method: string;
    nodeId: string;
    args?: unknown;
    xpath?: string;
  };
  method: string;
  nodeId: string;
  args?: unknown;
  xpath?: string;
  processedLength: number;
  totalLength: number;
  truncated: boolean;
  metadata?: { url: string; title: string };
  treeDiff?: {
    hasChanges: boolean;
    summary: string;
    added: string[];
    removed: string[];
    modified: string[];
    hasMore: {
      added: boolean;
      removed: boolean;
      modified: boolean;
    };
  } | null;
}

/**
 * Type for NodeIDs to URLs result
 */
export interface NodeIDsToURLsResult {
  urls: Array<{
    nodeId: string;
    url?: string;
  }>;
}

/**
 * Result type for the schema-based data extraction tool
 */
export interface SchemaBasedDataExtractionResult {
  success: boolean;
  message: string;
  jsonData: string;
  processedLength: number;
  totalLength: number;
  truncated: boolean;
  metadata?: { url: string; title: string };
}

/**
 * Type for wait result
 */
export interface WaitResult {
  waited: number;
  reason: string;
  completed: boolean;
  viewportSummary?: string;
}

/**
 * Tool for executing JavaScript in the page context
 */
export class ExecuteJavaScriptTool implements Tool<
  { code: string },
  JavaScriptExecutionResult | ErrorResult
> {
  name = "execute_javascript";
  description = "Executes JavaScript code in the page context";

  async execute(
    args: { code: string },
    ctx?: LLMContext,
  ): Promise<JavaScriptExecutionResult | ErrorResult> {
    logger.info("execute_javascript", args);
    const code = args.code;
    if (typeof code !== "string") {
      return { error: "Code must be a string" };
    }

    // Get adapter from context or fall back to SDK.Target
    const adapter = await getAdapter(ctx);
    if (!adapter) {
      return { error: "No browser connection available" };
    }

    try {
      // Execute the JavaScript in the page context
      const result = await adapter.runtimeAgent().invoke<{
        result: { value: unknown; type: string };
        exceptionDetails?: { text: string };
      }>("evaluate", {
        expression: code,
        returnByValue: true,
        generatePreview: true,
      });

      logger.info("execute_javascript result", result);

      if (result.exceptionDetails) {
        return {
          error: `JavaScript execution failed: ${result.exceptionDetails.text}`,
          exceptionDetails: result.exceptionDetails,
        };
      }

      return {
        result: result.result.value,
        type: result.result.type,
      };
    } catch (error) {
      return {
        error: `Failed to execute JavaScript: ${(error as Error).message}`,
      };
    }
  }

  schema = {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "JavaScript code to execute in the page context",
      },
    },
    required: ["code"],
  };
}

/**
 * Tool for analyzing network requests
 */
export class NetworkAnalysisTool implements Tool<
  { url?: string; limit?: number },
  NetworkAnalysisResult | ErrorResult
> {
  name = "analyze_network";
  description = "Analyzes network requests, optionally filtered by URL pattern";

  async execute(
    args: { url?: string; limit?: number },
    ctx?: LLMContext,
  ): Promise<NetworkAnalysisResult | ErrorResult> {
    const url = args.url;
    const limit = args.limit || 10;

    // NetworkAnalysisTool depends on DevTools NetworkLog which tracks requests over time
    // This is only available in DevTools browser context, not in eval runner / Node.js
    if (isNodeEnvironment) {
      return {
        error:
          "Network analysis requires DevTools NetworkLog and is only available in browser context",
      };
    }

    // Ensure browser dependencies are loaded
    await ensureToolsBrowserDeps();
    if (!SDK || !Logs) {
      return { error: "Network analysis is only available in browser context" };
    }

    try {
      // Get network manager
      const target =
        SDK.TargetManager.TargetManager.instance().primaryPageTarget();
      if (!target) {
        return { error: "Primary page target not available" };
      }

      const networkManager = target.model(SDK.NetworkManager.NetworkManager);
      if (!networkManager) {
        return { error: "Network manager not available" };
      }

      // Get network requests from NetworkLog
      const requests = Logs.NetworkLog.NetworkLog.instance().requests();

      // Filter by URL if provided
      const filteredRequests = url
        ? requests.filter((request: any) => request.url().includes(url))
        : requests;

      // Take only the specified limit
      const limitedRequests = filteredRequests.slice(-limit);

      // Map to simplified objects
      const mappedRequests = await Promise.all(
        limitedRequests.map(async (request: any) => {
          const requestHeaders = request.requestHeaders();
          const responseHeaders = request.responseHeaders;

          const requestHeadersMap: Record<string, string> = {};
          const responseHeadersMap: Record<string, string> = {};

          requestHeaders.forEach((header: any) => {
            requestHeadersMap[header.name] = header.value;
          });

          responseHeaders.forEach((header: any) => {
            responseHeadersMap[header.name] = header.value;
          });

          let responseBody = "";
          try {
            const contentData = await request.requestContentData();
            if ("error" in contentData) {
              responseBody = contentData.error;
            } else {
              responseBody = contentData.text;
            }
          } catch {
            // Ignore content errors
          }

          return {
            url: request.url(),
            method: request.requestMethod,
            status: request.statusCode,
            statusText: request.statusText,
            headers: requestHeadersMap,
            response: {
              headers: responseHeadersMap,
              body: responseBody,
            },
          };
        }),
      );

      return {
        requests: mappedRequests,
      };
    } catch (error) {
      return { error: `Failed to analyze network: ${error.message}` };
    }
  }

  schema = {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL pattern to filter requests (optional)",
      },
      limit: {
        type: "number",
        description: "Maximum number of requests to return (default: 10)",
      },
    },
  };
}

/**
 * Tool for navigating to a URL
 */
/**
 * Result type for the navigate back tool
 */
export interface NavigateBackResult {
  success: boolean;
  message: string;
  steps: number;
  metadata?: { url: string; title: string };
}

/**
 * Helper function to wait for the page load event with a timeout.
 * @param target The SDK.Target.Target to monitor.
 * @param timeoutMs The timeout duration in milliseconds.
 * @returns A promise that resolves when the load event occurs or rejects on timeout/error.
 * @note This function requires browser context (SDK, Common must be loaded).
 */
export async function waitForPageLoad(
  target: any,
  timeoutMs: number,
): Promise<void> {
  // Ensure browser dependencies are loaded
  if (!SDK || !Common) {
    throw new Error(
      "waitForPageLoad requires browser context (SDK not available)",
    );
  }

  const resourceTreeModel = target.model(
    SDK.ResourceTreeModel.ResourceTreeModel,
  );
  if (!resourceTreeModel) {
    throw new Error("ResourceTreeModel not found for target.");
  }
  const runtimeAgent = target.runtimeAgent();
  if (!runtimeAgent) {
    throw new Error("RuntimeAgent not found for target.");
  }

  let lifecycleEventListener: any | null = null;
  let overallTimeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    // Enable lifecycle events for networkAlmostIdle detection
    await resourceTreeModel.setLifecycleEventsEnabled(true);

    // 1. Overall Timeout Promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      overallTimeoutId = setTimeout(() => {
        logger.warn(
          `waitForPageLoad: Overall timeout reached after ${timeoutMs}ms`,
        );
        reject(new Error(`Page load timed out after ${timeoutMs}ms (Overall)`));
      }, timeoutMs);
    });

    // 2. Network Almost Idle Promise (via lifecycle events)
    const networkIdlePromise = new Promise<void>((resolve) => {
      lifecycleEventListener = resourceTreeModel.addEventListener(
        SDK!.ResourceTreeModel.Events.LifecycleEvent,
        (event: any) => {
          const { name } = event.data;
          // networkAlmostIdle means ≤2 network connections for 500ms
          if (name === "networkAlmostIdle" || name === "networkIdle") {
            logger.info(`waitForPageLoad: ${name} lifecycle event received.`);
            resolve();
          }
        },
      );
    });

    // 3. LCP Promise (via injected script)
    const lcpPromise = (async (): Promise<void> => {
      // Internal timeout slightly less than the main one, minimum 100ms
      const internalTimeout = Math.max(100, timeoutMs - 100);
      const expression = `
        new Promise((resolve, reject) => {
          let observer;
          const timeoutId = setTimeout(() => {
            if (observer) observer.disconnect();
            // Don't reject, just resolve with a "timeout" status
            // This allows the main race to continue waiting for 'load' or the overall timeout
            resolve('LCP observer timed out internally after ${internalTimeout}ms.');
          }, ${internalTimeout});

          try {
            observer = new PerformanceObserver((entryList) => {
              if (entryList.getEntriesByType('largest-contentful-paint').length > 0) {
                clearTimeout(timeoutId);
                observer.disconnect();
                resolve('LCP detected');
              }
            });
            // Use buffered: true to capture LCP if it happened before the observer started
            observer.observe({ type: 'largest-contentful-paint', buffered: true });
          } catch (e) {
            clearTimeout(timeoutId);
            // Don't reject, resolve with an error status
            resolve('Failed to set up LCP PerformanceObserver: ' + (e instanceof Error ? e.message : String(e)));
          }
        })
      `;
      try {
        logger.info("waitForPageLoad: Starting LCP observer...");
        const result = await runtimeAgent.invoke_evaluate({
          expression,
          awaitPromise: true, // Wait for the script's promise
          returnByValue: true, // Get the resolution value (string)
          silent: true, // Reduce console noise from evaluation itself
        });

        if (result.exceptionDetails) {
          logger.warn(
            `waitForPageLoad: LCP observer script failed evaluation: ${result.exceptionDetails.text}`,
          );
          // Evaluation failed, LCP won't resolve successfully.
          // Return a promise that never resolves to take it out of the race.
          return new Promise(() => {});
        }

        const lcpStatus = result.result.value as string;
        if (lcpStatus === "LCP detected") {
          logger.info("waitForPageLoad: LCP detected via observer.");
          // Resolve the outer lcpPromise successfully
          return Promise.resolve();
        }
        // LCP observer timed out internally or failed setup
        logger.warn(
          `waitForPageLoad: LCP observer finished with status: "${lcpStatus}"`,
        );
        // Return a promise that never resolves.
        return new Promise(() => {});
      } catch (error) {
        // Catch errors invoking evaluate itself
        logger.warn(
          `waitForPageLoad: Error invoking LCP observer script: ${error instanceof Error ? error.message : String(error)}`,
        );
        // Invocation failed, LCP won't resolve. Return a promise that never resolves.
        return await new Promise(() => {});
      }
    })();

    // 4. Race the promises: Wait for the first of networkIdle, LCP, or timeout
    logger.info(
      `waitForPageLoad: Waiting for networkIdle, LCP, or timeout (${timeoutMs}ms)...`,
    );
    await Promise.race([networkIdlePromise, lcpPromise, timeoutPromise]);
    logger.info(
      "waitForPageLoad: Race finished (networkIdle, LCP, or Timeout).",
    );
  } catch (error) {
    // This catch block will primarily handle the overall timeout rejection
    logger.error(
      `waitForPageLoad: Wait failed - ${error instanceof Error ? error.message : String(error)}`,
    );
    // Rethrow the error (likely the timeout error)
    throw error;
  } finally {
    // 5. Cleanup
    if (overallTimeoutId !== null) {
      clearTimeout(overallTimeoutId);
    }
    if (lifecycleEventListener && Common) {
      Common.EventTarget.removeEventListeners([lifecycleEventListener]);
      logger.info("waitForPageLoad: Lifecycle event listener removed.");
    }
    // The LCP observer should disconnect itself within the injected script.
  }
}

export class NavigateURLTool implements Tool<
  { url: string; reasoning: string },
  NavigationResult | ErrorResult
> {
  name = "navigate_url";
  description =
    "Navigates the page to a specified URL and waits for it to load";

  constructor() {}

  async execute(
    args: { url: string; reasoning: string /* Add reasoning to signature */ },
    ctx?: LLMContext,
  ): Promise<NavigationResult | ErrorResult> {
    logger.info("navigate_url", args);
    const url = args.url;
    const LOAD_TIMEOUT_MS = 30000; // 30 seconds timeout for page load

    if (typeof url !== "string") {
      return { error: "URL must be a string" };
    }

    // Use getAdapter pattern - works in both DevTools and eval runner contexts
    const adapter = await getAdapter(ctx);
    if (!adapter) {
      return { error: "No browser connection available" };
    }

    try {
      logger.info(`Initiating navigation to: ${url}`);

      // Perform the navigation using CDP Page.navigate
      const result = await adapter
        .pageAgent()
        .invoke<{
          frameId: string;
          loaderId?: string;
          errorText?: string;
        }>("navigate", { url });

      if (result.errorText) {
        logger.error(`Navigation invocation failed: ${result.errorText}`);
        return { error: `Navigation invocation failed: ${result.errorText}` };
      }
      logger.info("Navigation initiated successfully.");

      // Wait for page load by polling document.readyState
      try {
        await this.waitForPageLoadViaAdapter(adapter, LOAD_TIMEOUT_MS);
        logger.info("Page load confirmed or timeout reached.");
      } catch (loadError: any) {
        logger.error(`Error waiting for page load: ${loadError.message}`);
      }

      // Fetch page metadata AFTER waiting
      logger.info("Fetching page metadata...");
      const metadataEval = await adapter.runtimeAgent().invoke<{
        result: { value: { url: string; title: string } };
        exceptionDetails?: { text: string };
      }>("evaluate", {
        expression: "({ url: window.location.href, title: document.title })",
        returnByValue: true,
      });

      // Handle potential errors during metadata evaluation
      if (metadataEval.exceptionDetails) {
        logger.error(
          `Error fetching metadata: ${metadataEval.exceptionDetails.text}`,
        );
        return {
          url: adapter.inspectedURL() || url,
          message: `Successfully navigated to ${adapter.inspectedURL() || url}, but failed to fetch metadata: ${metadataEval.exceptionDetails.text}`,
          metadata: undefined,
        };
      }

      const metadata = metadataEval.result.value as {
        url: string;
        title: string;
      };
      logger.info("Metadata fetched:", metadata);

      // Update adapter URL after navigation
      if ("updateURL" in adapter && typeof adapter.updateURL === "function") {
        adapter.updateURL(metadata.url);
      }

      // *** Add 404 detection heuristic ***
      const is404Result = await this.check404Status(adapter, metadata, ctx);
      if (is404Result.is404) {
        return {
          error: `Page not found (404): ${is404Result.reason}`,
        };
      }
      // ************************************

      // *** Add verification: Compare intended URL with final URL ***
      const intendedUrl = args.url;
      const finalUrl = metadata.url;

      // Basic normalization: remove trailing slash and ensure http/https
      const normalizeUrl = (urlStr: string): string => {
        try {
          const urlObj = new URL(urlStr);
          // Keep protocol, hostname, pathname. Remove trailing slash from pathname.
          const pathname = urlObj.pathname.endsWith("/")
            ? urlObj.pathname.slice(0, -1)
            : urlObj.pathname;
          return `${urlObj.protocol}//${urlObj.hostname}${pathname}${urlObj.search}${urlObj.hash}`;
        } catch (e) {
          // If URL parsing fails, return original string (lowercased for consistency)
          return urlStr.toLowerCase().trim();
        }
      };

      const normalizedIntendedUrl = normalizeUrl(intendedUrl);
      const normalizedFinalUrl = normalizeUrl(finalUrl);

      let verificationMessage = "";
      let navigationVerified = normalizedIntendedUrl === normalizedFinalUrl;

      // Allow for HTTP -> HTTPS redirect as a valid case
      if (
        !navigationVerified &&
        normalizedIntendedUrl.startsWith("http://") &&
        normalizedFinalUrl.startsWith("https://")
      ) {
        const intendedHttps = "https" + normalizedIntendedUrl.substring(4);
        if (intendedHttps === normalizedFinalUrl) {
          navigationVerified = true;
          verificationMessage = " (Redirected to HTTPS)";
        }
      }

      if (!navigationVerified) {
        logger.warn(
          `URL mismatch after navigation. Intended: ${intendedUrl}, Final: ${finalUrl}`,
        );
        // Return an error or modify success message?
        // Let's modify the message but still return success=true, as the page *did* load.
        return {
          url: finalUrl,
          message: `Navigation ended at ${finalUrl} (expected ${intendedUrl}) but page loaded.${verificationMessage}`,
          metadata,
        };
      }
      // **********************************************************

      return {
        url: metadata.url, // Use URL from metadata
        message: `Navigated to ${metadata.url} and page loaded.${verificationMessage}`,
        metadata,
      };
    } catch (error: any) {
      logger.error(`Unexpected error: ${error.message}`);
      return { error: `Failed to navigate to URL: ${error.message}` };
    }
  }

  /**
   * Wait for page load by polling document.readyState via the adapter.
   * This works in both DevTools and eval runner contexts.
   */
  private async waitForPageLoadViaAdapter(
    adapter: CDPSessionAdapter,
    timeoutMs: number,
  ): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 100; // Poll every 100ms

    while (Date.now() - startTime < timeoutMs) {
      try {
        const result = await adapter.runtimeAgent().invoke<{
          result: { value: string };
          exceptionDetails?: { text: string };
        }>("evaluate", {
          expression: "document.readyState",
          returnByValue: true,
        });

        if (result.result?.value === "complete") {
          logger.info("Page load complete (document.readyState = complete)");
          return;
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch (error) {
        // If evaluation fails, the page might be navigating - wait and retry
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    }

    logger.warn("Page load timeout reached");
  }

  private async check404Status(
    adapter: CDPSessionAdapter,
    metadata: { url: string; title: string },
    ctx?: LLMContext,
  ): Promise<{ is404: boolean; reason?: string }> {
    try {
      // Basic heuristic checks first
      const title = metadata.title.toLowerCase();

      // Common 404 indicators in title
      const titleIndicators = [
        "404",
        "not found",
        "page not found",
        "file not found",
        "error 404",
        "404 error",
        "page cannot be found",
        "the page you requested was not found",
        "page does not exist",
      ];

      const hasTitle404 = titleIndicators.some((indicator) =>
        title.includes(indicator),
      );

      // If obvious 404 indicators, return true (skip LLM confirmation for adapter context)
      if (hasTitle404) {
        logger.info("404 detected based on page title");
        return {
          is404: true,
          reason: "Page title indicates this is a 404 error page",
        };
      }

      return { is404: false };
    } catch (error: any) {
      logger.error("Error checking 404 status:", error);
      return { is404: false };
    }
  }

  private async confirmWith404LLM(
    url: string,
    title: string,
    content: string,
    ctx?: LLMContext,
  ): Promise<boolean> {
    try {
      // Get API key from context first (for eval runner), fallback to AgentService
      let apiKey = ctx?.apiKey;
      if (!apiKey && !isNodeEnvironment) {
        await ensureToolsBrowserDeps();
        if (AgentService) {
          apiKey = AgentService.getInstance().getApiKey() ?? undefined;
        }
      }
      if (!apiKey) {
        logger.warn("No API key available for 404 confirmation");
        return false;
      }

      if (!ctx?.provider || !ctx.nanoModel) {
        logger.warn("Missing LLM context for 404 confirmation");
        return false;
      }
      const provider = ctx.provider;
      const model = ctx.nanoModel;
      const llm = LLMClient.getInstance();

      const systemPrompt = `You are analyzing web page content to determine if it represents a 404 "Page Not Found" error page.
Return ONLY "true" if this is definitely a 404 error page, or "false" if it's a legitimate page with content.`;

      const userPrompt = `Analyze this page and determine if it's a 404 error page:

URL: ${url}
Title: ${title}
Content (first 1000 chars): ${content.substring(0, 1000)}

Is this a 404 error page? Answer only "true" or "false".`;

      const response = await llm.call({
        provider,
        model,
        messages: [{ role: "user", content: userPrompt }],
        systemPrompt,
        temperature: 0.1,
      });

      const result = response.text?.trim().toLowerCase();
      return result === "true";
    } catch (error: any) {
      logger.error("Error confirming 404 with LLM:", error);
      return false;
    }
  }

  schema = {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL to navigate to",
      },
      reasoning: {
        type: "string",
        description:
          "Reasoning for the action. This is a free form text field that will be used to explain the action to the user.",
      },
    },
    required: ["url", "reasoning"],
  };
}

/**
 * Tool for navigating back in browser history
 */
export class NavigateBackTool implements Tool<
  { steps: number; reasoning: string },
  NavigateBackResult | ErrorResult
> {
  name = "navigate_back";
  description =
    "Navigates back in browser history by a specified number of steps";

  schema = {
    type: "object",
    properties: {
      steps: {
        type: "number",
        description: "Number of pages to go back in browser history",
      },
      reasoning: {
        type: "string",
        description:
          "Reasoning for the action. This is a free form text field that will be used to explain the action to the user.",
      },
    },
    required: ["steps", "reasoning"],
  };

  async execute(
    args: { steps: number; reasoning: string },
    ctx?: LLMContext,
  ): Promise<NavigateBackResult | ErrorResult> {
    logger.info("navigate_back", args);
    const steps = args.steps;
    if (typeof steps !== "number" || steps <= 0) {
      return { error: "Steps must be a positive number" };
    }

    // Use getAdapter pattern - works in both DevTools and eval runner contexts
    const adapter = await getAdapter(ctx);
    if (!adapter) {
      return { error: "No browser connection available" };
    }

    try {
      // First, check if we can go back that many steps
      const historyLengthResult = await adapter.runtimeAgent().invoke<{
        result: { value: number };
        exceptionDetails?: { text: string };
      }>("evaluate", {
        expression: "window.history.length",
        returnByValue: true,
      });

      if (historyLengthResult.exceptionDetails) {
        return {
          error: `Failed to check history length: ${historyLengthResult.exceptionDetails.text}`,
        };
      }

      const historyLength = historyLengthResult.result.value;
      if (historyLength <= steps) {
        return {
          error: `Cannot go back ${steps} pages. History only contains ${historyLength} entries.`,
        };
      }

      // Execute history.go(-steps) to go back
      const result = await adapter.runtimeAgent().invoke<{
        exceptionDetails?: { text: string };
      }>("evaluate", {
        expression: `window.history.go(-${steps})`,
        returnByValue: true,
      });

      if (result.exceptionDetails) {
        return { error: `Navigation failed: ${result.exceptionDetails.text}` };
      }

      // Wait for navigation to complete using a polling approach
      const startTime = Date.now();
      const timeoutMs = 5000; // 5 second timeout
      let isNavigationComplete = false;

      const signal = ctx?.abortSignal;
      // Poll until navigation completes, cancels, or times out
      while (!isNavigationComplete && Date.now() - startTime < timeoutMs) {
        if (signal?.aborted) {
          throw new DOMException("The operation was aborted", "AbortError");
        }
        // Short delay between checks
        await abortableSleep(100, signal);

        // Check if navigation is complete by testing document readyState
        try {
          const readyStateResult = await adapter.runtimeAgent().invoke<{
            result: { value: string };
            exceptionDetails?: { text: string };
          }>("evaluate", {
            expression: "document.readyState",
            returnByValue: true,
          });

          if (
            readyStateResult &&
            !readyStateResult.exceptionDetails &&
            readyStateResult.result.value === "complete"
          ) {
            isNavigationComplete = true;
            logger.info(
              "Navigation completed, document ready state is complete",
            );
          }
        } catch {
          // If we can't evaluate yet, navigation is still in progress
          logger.info("Still waiting for navigation to complete...");
        }
      }

      if (!isNavigationComplete) {
        logger.warn(
          "Navigation timed out after waiting for document ready state",
        );
      }

      // Fetch page metadata
      const metadataEval = await adapter.runtimeAgent().invoke<{
        result: { value: { url: string; title: string } };
      }>("evaluate", {
        expression: "({ url: window.location.href, title: document.title })",
        returnByValue: true,
      });
      const metadata = metadataEval.result.value;

      return {
        success: true,
        steps,
        message: `Successfully navigated back ${steps} page${steps > 1 ? "s" : ""}`,
        metadata,
      };
    } catch (error: unknown) {
      return {
        error: `Failed to navigate back: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

/**
 * Tool for getting the HTML contents of the current page
 */
export class GetPageHTMLTool implements Tool<
  Record<string, unknown>,
  PageHTMLResult | ErrorResult
> {
  name = "get_page_html";
  description =
    "Gets the HTML contents and structure of the current page for analysis and summarization with CSS, JavaScript, and other non-essential content removed";

  async execute(
    _args: Record<string, unknown>,
    ctx?: LLMContext,
  ): Promise<PageHTMLResult | ErrorResult> {
    // Use getAdapter pattern - works in both DevTools and eval runner contexts
    const adapter = await getAdapter(ctx);
    if (!adapter) {
      return { error: "No browser connection available" };
    }

    try {
      // Use the runtime agent to get the page HTML and additional information
      const result = await adapter.runtimeAgent().invoke<{
        result: { value: PageHTMLResult };
        exceptionDetails?: { text?: string };
      }>("evaluate", {
        expression: `(() => {
          // Function to get simplified text content from HTML
          function getSimplifiedHTML() {
            // Get the HTML directly
            const html = document.documentElement.outerHTML;

            // Create a temporary DOM element
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;

            // Remove all script and style tags
            const scriptTags = tempDiv.querySelectorAll('script');
            scriptTags.forEach(script => script.remove());

            const styleTags = tempDiv.querySelectorAll('style');
            styleTags.forEach(style => style.remove());

            // Return the cleaned HTML
            return tempDiv.innerHTML;
          }

          // Get raw HTML for structure analysis
          const rawHtml = document.documentElement.outerHTML;

          // Basic page info with stripped HTML text
          const basicInfo = {
            html: getSimplifiedHTML(rawHtml),
            documentTitle: document.title,
            url: window.location.href
          };

          // Extract metadata
          const metadata = {};
          const metaTags = document.querySelectorAll('meta');
          metaTags.forEach(tag => {
            const name = tag.getAttribute('name') || tag.getAttribute('property');
            const content = tag.getAttribute('content');
            if (name && content) {
              metadata[name] = content;
            }
          });

          // Extract page structure - headings
          const headings = [];
          document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
            const level = parseInt(heading.tagName.substring(1), 10);
            const text = heading.textContent ? heading.textContent.trim() : '';
            if (text) {
              headings.push({ level, text });
            }
          });

          // Extract navigation as text only
          let navigation = '';
          const navElement = document.querySelector('nav') ||
                            document.querySelector('header') ||
                            document.querySelector('[role="navigation"]');

          if (navElement) {
            navigation = navElement.textContent.trim();
          }

          return {
            ...basicInfo,
            metadata: {
              description: metadata['description'] || metadata['og:description'],
              keywords: metadata['keywords'],
              author: metadata['author'],
              ...metadata
            },
            structure: {
              headings,
              navigation
            }
          };
        })()`,
        returnByValue: true,
      });

      if (result.exceptionDetails) {
        return {
          error: `Failed to get page HTML: ${result.exceptionDetails.text || JSON.stringify(result.exceptionDetails)}`,
        };
      }

      return result.result.value;
    } catch (error) {
      return { error: `Failed to get page HTML, error: ${error}` };
    }
  }

  schema = {
    type: "object",
    properties: {},
  };
}

/**
 * Tool for clicking elements on the page
 */
export class ClickElementTool implements Tool<
  { selector: string },
  ClickElementResult | ErrorResult
> {
  name = "click_element";
  description = "Clicks on an element identified by a CSS selector";

  async execute(
    args: { selector: string },
    ctx?: LLMContext,
  ): Promise<ClickElementResult | ErrorResult> {
    const selector = args.selector;
    if (typeof selector !== "string") {
      return { error: "Selector must be a string" };
    }

    // Get adapter from context or fall back to SDK.Target
    const adapter = await getAdapter(ctx);
    if (!adapter) {
      return { error: "No browser connection available" };
    }

    try {
      // Execute the click operation in the page context
      const result = await adapter.runtimeAgent().invoke<{
        result: { value: ClickElementResult | ErrorResult };
      }>("evaluate", {
        expression: `(() => {
          const element = document.querySelector("${selector}");
          if (!element) {
            return {
              success: false,
              message: "Element not found with selector: ${selector}"
            };
          }

          // Get element info before clicking
          const tagName = element.tagName.toLowerCase();
          const text = element.textContent ? element.textContent.trim() : '';
          const href = element.getAttribute('href');

          // Attempt to scroll element into view if needed
          element.scrollIntoView({behavior: 'smooth', block: 'center'});

          // Simulate a click
          element.click();

          return {
            success: true,
            message: "Successfully clicked element",
            elementInfo: {
              tagName,
              text,
              href
            }
          };
        })()`,
        returnByValue: true,
      });

      return result.result.value;
    } catch (error) {
      return { error: `Failed to click element: ${(error as Error).message}` };
    }
  }

  schema = {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector of the element to click",
      },
    },
    required: ["selector"],
  };
}

/**
 * Tool for searching content on the page
 */
export class SearchContentTool implements Tool<
  { query: string; limit?: number },
  SearchContentResult | ErrorResult
> {
  name = "search_content";
  description =
    "Searches for text content on the page and returns matching elements";

  async execute(
    args: { query: string; limit?: number },
    ctx?: LLMContext,
  ): Promise<SearchContentResult | ErrorResult> {
    const query = args.query;
    const limit = args.limit || 5;

    if (typeof query !== "string") {
      return { error: "Query must be a string" };
    }

    // Get adapter from context or fall back to SDK.Target
    const adapter = await getAdapter(ctx);
    if (!adapter) {
      return { error: "No browser connection available" };
    }

    try {
      // Execute the search in the page context
      const result = await adapter.runtimeAgent().invoke<{
        result: { value: SearchContentResult };
      }>("evaluate", {
        expression: `(() => {
          const query = "${query}";
          const limit = ${limit};

          // Helper function to get a unique selector for an element
          function getSelector(element) {
            if (element.id) {
              return '#' + element.id;
            }
            if (element.className && typeof element.className === 'string') {
              return '.' + element.className.trim().replace(/\\s+/g, '.');
            }

            // Fallback to path
            let path = '';
            let current = element;
            while (current && current !== document.body) {
              let selector = current.tagName.toLowerCase();
              if (current.parentNode) {
                const siblings = Array.from(current.parentNode.children);
                if (siblings.length > 1) {
                  const index = siblings.indexOf(current) + 1;
                  selector += ':nth-child(' + index + ')';
                }
              }
              path = selector + (path ? ' > ' + path : '');
              current = current.parentNode;
            }
            return path ? 'body > ' + path : path;
          }

          // Create a TreeWalker to navigate all text nodes
          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode: function(node) {
                // Filter out script and style content
                const parent = node.parentNode;
                if (parent && (
                    parent.nodeName === 'SCRIPT' ||
                    parent.nodeName === 'STYLE' ||
                    parent.nodeName === 'NOSCRIPT'
                )) {
                  return NodeFilter.FILTER_REJECT;
                }

                // Only accept nodes that contain our query
                if (node.textContent && node.textContent.toLowerCase().includes(query.toLowerCase())) {
                  return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_REJECT;
              }
            }
          );

          const matches = [];
          let node;

          // Collect matches
          while ((node = walker.nextNode()) && matches.length < limit) {
            const element = node.parentNode;
            const text = node.textContent.trim();

            // Get some surrounding text for context
            const wholeText = text;
            const lowerText = wholeText.toLowerCase();
            const queryIndex = lowerText.indexOf(query.toLowerCase());

            // Create a context snippet
            let startIndex = Math.max(0, queryIndex - 30);
            let endIndex = Math.min(wholeText.length, queryIndex + query.length + 30);
            let contextText = wholeText.substring(startIndex, endIndex);

            // Add ellipsis if we truncated the text
            if (startIndex > 0) contextText = '...' + contextText;
            if (endIndex < wholeText.length) contextText = contextText + '...';

            matches.push({
              text,
              context: contextText,
              elementInfo: {
                tagName: element.tagName.toLowerCase(),
                selector: getSelector(element)
              }
            });
          }

          return {
            matches,
            totalMatches: matches.length
          };
        })()`,
        returnByValue: true,
      });

      return result.result.value;
    } catch (error) {
      return { error: `Failed to search content: ${(error as Error).message}` };
    }
  }

  schema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Text to search for on the page",
      },
      limit: {
        type: "number",
        description: "Maximum number of matches to return (default: 5)",
      },
    },
    required: ["query"],
  };
}

/**
 * Tool for scrolling the page
 */
export class ScrollPageTool implements Tool<
  {
    position?: { x: number; y: number };
    direction?: string;
    amount?: number;
    pages?: number;
  },
  ScrollResult | ErrorResult
> {
  name = "scroll_page";
  description =
    "Scrolls the page to a specific position, in a direction, or by viewport pages. Use pages parameter for predictable scrolling (e.g., pages: 1 scrolls down one full viewport height, pages: -1 scrolls up).";

  async execute(
    args: {
      position?: { x: number; y: number };
      direction?: string;
      amount?: number;
      pages?: number;
    },
    ctx?: LLMContext,
  ): Promise<ScrollResult | ErrorResult> {
    const position = args.position;
    const pages = args.pages;
    const direction = args.direction;
    const amount = args.amount || 300; // Default scroll amount

    // Priority: position > pages > direction
    if (!position && pages === undefined && !direction) {
      return { error: "Either position, pages, or direction must be provided" };
    }

    // Get adapter from context or fall back to SDK.Target
    const adapter = await getAdapter(ctx);
    if (!adapter) {
      return { error: "No browser connection available" };
    }

    try {
      // Execute the scroll operation in the page context
      const result = await adapter.runtimeAgent().invoke<{
        result: { value: ScrollResult };
      }>("evaluate", {
        expression: `(() => {
          ${
            position
              ? `// Scroll to specific position
            window.scrollTo({
              left: ${position.x || 0},
              top: ${position.y || 0},
              behavior: 'smooth'
            });`
              : pages !== undefined
                ? `// Scroll by viewport heights
            const viewportHeight = window.innerHeight;
            const scrollAmount = viewportHeight * ${pages};
            window.scrollBy({
              top: scrollAmount,
              behavior: 'smooth'
            });`
                : `// Scroll in direction
            const direction = "${direction}";
            const amount = ${amount};

            if (direction === "up") {
              window.scrollBy({top: -amount, behavior: 'smooth'});
            } else if (direction === "down") {
              window.scrollBy({top: amount, behavior: 'smooth'});
            } else if (direction === "left") {
              window.scrollBy({left: -amount, behavior: 'smooth'});
            } else if (direction === "right") {
              window.scrollBy({left: amount, behavior: 'smooth'});
            } else if (direction === "top") {
              window.scrollTo({top: 0, behavior: 'smooth'});
            } else if (direction === "bottom") {
              window.scrollTo({top: document.body.scrollHeight, behavior: 'smooth'});
            }`
          }

          // Return current scroll position with viewport info
          return {
            success: true,
            message: "Scroll operation completed",
            position: {
              x: window.pageXOffset,
              y: window.pageYOffset
            },
            viewportHeight: window.innerHeight,
            scrollHeight: document.documentElement.scrollHeight,
            scrolledPages: ${pages !== undefined ? pages : 0}
          };
        })()`,
        returnByValue: true,
      });

      return result.result.value;
    } catch (error) {
      return { error: `Failed to scroll page: ${(error as Error).message}` };
    }
  }

  schema = {
    type: "object",
    properties: {
      position: {
        type: "object",
        description: "Specific position to scroll to (x and y coordinates)",
        properties: {
          x: {
            type: "number",
            description: "X coordinate to scroll to",
          },
          y: {
            type: "number",
            description: "Y coordinate to scroll to",
          },
        },
      },
      pages: {
        type: "number",
        description:
          "Number of viewport heights to scroll. Positive scrolls down, negative scrolls up. Examples: 1 (one page down), 0.5 (half page down), -1 (one page up), 2 (two pages down). This is the recommended way to scroll for content extraction workflows.",
      },
      direction: {
        type: "string",
        description:
          "Direction to scroll (up, down, left, right, top, bottom). Use pages parameter instead for more predictable scrolling.",
        enum: ["up", "down", "left", "right", "top", "bottom"],
      },
      amount: {
        type: "number",
        description:
          "Amount to scroll in pixels when using direction (default: 300). Use pages parameter instead for viewport-relative scrolling.",
      },
    },
  };
}

/**
 * Tool for waiting a specified duration
 */
export class WaitTool implements Tool<
  { seconds?: number; duration?: number; reason?: string; reasoning?: string },
  WaitResult | ErrorResult
> {
  name = "wait_for_page_load";
  description =
    "Waits for a specified number of seconds to allow page content to load, animations to complete, or dynamic content to appear. After waiting, returns a summary of what is currently visible in the viewport to help determine if additional waiting is needed. Provide the number of seconds to wait and an optional reasoning for waiting.";

  async execute(
    args: {
      seconds?: number;
      duration?: number;
      reason?: string;
      reasoning?: string;
    },
    ctx?: LLMContext,
  ): Promise<WaitResult | ErrorResult> {
    const signal = ctx?.abortSignal;
    const sleep = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        if (!ms) return resolve();
        const timer = setTimeout(() => {
          cleanup();
          resolve();
        }, ms);
        const onAbort = () => {
          clearTimeout(timer);
          cleanup();
          reject(new DOMException("The operation was aborted", "AbortError"));
        };
        const cleanup = () => {
          signal?.removeEventListener("abort", onAbort);
        };
        if (signal) {
          if (signal.aborted) {
            clearTimeout(timer);
            cleanup();
            return reject(
              new DOMException("The operation was aborted", "AbortError"),
            );
          }
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    // Handle both 'seconds' and 'duration' parameter names for flexibility
    const waitTime = args.seconds ?? args.duration;
    const waitReason = args.reason ?? args.reasoning;

    // Validate input
    if (typeof waitTime !== "number") {
      return {
        error:
          'Must provide either "seconds" or "duration" parameter as a number',
      };
    }

    if (waitTime < 0.1) {
      return { error: "Wait time must be at least 0.1 seconds" };
    }

    if (waitTime > 300) {
      return {
        error: "Wait time cannot exceed 300 seconds (5 minutes) for safety",
      };
    }

    // Log the wait reason if provided
    logger.info(
      `Waiting for ${waitTime} seconds${waitReason ? `: ${waitReason}` : ""}`,
    );

    // Wait for the specified duration (abortable)
    await sleep(waitTime * 1000);

    // Get viewport summary after waiting
    let viewportSummary: string | undefined;
    try {
      // Get adapter from context (works in both DevTools and eval runner)
      const adapter = await getAdapter(ctx);
      if (adapter) {
        // Get visible accessibility tree using universal utils
        const treeResult = await UtilsUniversal.getAccessibilityTree(adapter);

        // Generate summary using LLM if ctx is available
        if (ctx?.provider && ctx.nanoModel) {
          const provider = ctx.provider;
          const model = ctx.nanoModel;
          const llm = LLMClient.getInstance();

          const reasonContext = waitReason
            ? `The wait was specifically for: ${waitReason}`
            : "No specific reason was provided for the wait.";

          const systemPrompt = `You are analyzing the visible content of a webpage after a wait period. ${reasonContext}

Provide a concise summary of what's currently visible in the viewport, paying special attention to elements related to the wait reason.

Focus on:
- Main content elements (headings, buttons, forms, text)
- Loading indicators or spinners
- Error messages or notifications
- Whether the page appears fully loaded or still loading
- Any animations or transitions in progress
- Elements specifically related to the wait reason (if provided)

Keep the summary to 2-3 sentences maximum.`;

          const userPrompt = `Analyze this viewport content and provide a brief summary${waitReason ? `, focusing on elements related to: ${waitReason}` : ""}:
${treeResult.simplified}`;

          const response = await llm.call({
            provider,
            model,
            messages: [{ role: "user", content: userPrompt }],
            systemPrompt,
            temperature: 0.1,
          });

          viewportSummary = response.text?.trim();
        }
      }
    } catch (error) {
      // Non-critical error - just log and continue
      logger.warn("Failed to generate viewport summary:", error);
    }

    return {
      waited: waitTime,
      reason: waitReason || "Waiting for page to settle",
      completed: true,
      viewportSummary,
    };
  }

  schema = {
    type: "object",
    properties: {
      seconds: {
        type: "number",
        description: "Number of seconds to wait (minimum 0.1, maximum 300)",
        minimum: 0.1,
        maximum: 300,
      },
      duration: {
        type: "number",
        description:
          "Alternative to seconds - number of seconds to wait (minimum 0.1, maximum 300)",
        minimum: 0.1,
        maximum: 300,
      },
      reasoning: {
        type: "string",
        description:
          'Optional reasoning for waiting (e.g., "for animation to complete", "for content to load")',
      },
      reason: {
        type: "string",
        description: "Alternative to reasoning - optional reason for waiting",
      },
    },
  };
}

/**
 * Tool for taking screenshots of the page
 */
export class TakeScreenshotTool implements Tool<
  { fullPage?: boolean },
  ScreenshotResult | ErrorResult
> {
  name = "take_screenshot";
  description =
    "Takes a screenshot of the current page view or the entire page. The image can be used for analyzing the page layout, content, and visual elements. Always specify whether to capture the full page or just the viewport and the reasoning behind it.";

  async execute(
    args: { fullPage?: boolean },
    ctx?: LLMContext,
  ): Promise<ScreenshotResult | ErrorResult> {
    const fullPage = args.fullPage || false;

    // Get adapter from context or fall back to SDK.Target
    const adapter = await getAdapter(ctx);
    if (!adapter) {
      return { error: "No browser connection available" };
    }

    try {
      // Take the screenshot using page agent
      const result = await adapter.pageAgent().invoke<{
        data: string;
      }>("captureScreenshot", {
        format: "png",
        captureBeyondViewport: fullPage,
      });

      const imageData = `data:image/png;base64,${result.data}`;

      return {
        imageData: imageData,
      };
    } catch (error) {
      return {
        error: `Failed to take screenshot: ${(error as Error).message}`,
      };
    }
  }

  schema = {
    type: "object",
    properties: {
      fullPage: {
        type: "boolean",
        description:
          "Whether to capture the entire page or just the viewport (default: false)",
      },
      reasoning: {
        type: "string",
        description:
          'Optional reasoning for taking the screenshot (e.g., "for visual analysis", "to capture layout")',
      },
    },
  };
}

/**
 * Static cache for HybridSnapshot from multi-frame accessibility tree.
 * Used by perform_action to resolve EncodedId nodeIds to XPaths.
 */
let cachedHybridSnapshot: HybridSnapshot | null = null;

/**
 * Result type for accessibility tree search
 */
export interface SearchMatch {
  id: string;
  role: string;
  name: string;
  context?: string;
  score?: number;
  matchType?: 'role' | 'name' | 'both';
}

/**
 * Extended result type for get_page_content with chunking support
 */
export interface ChunkedAccessibilityTreeResult extends AccessibilityTreeResult {
  chunkIndex?: number;
  totalChunks?: number;
  truncated?: boolean;
  focusElementId?: string;
  matches?: SearchMatch[];
  totalMatches?: number;
}

/**
 * Search accessibility tree for elements matching query (relevance-ranked)
 * Uses AccessibilityTreeSearcher with weighted scoring for relevance.
 * @param tree The accessibility tree string
 * @param query Search query to match against role/name/text
 * @param maxResults Maximum results (default: 20, max: 100)
 * @returns Array of matching elements sorted by relevance score
 */
function searchAccessibilityTree(tree: string, query: string, maxResults: number = 20): SearchMatch[] {
  // ScoredSearchMatch is structurally compatible with SearchMatch
  return searchAccessibilityTreeImpl(tree, query, maxResults);
}

/**
 * Extract subtree starting from specific element (element + descendants only)
 * @param tree The full accessibility tree string
 * @param focusId The EncodedId of the element to focus on
 * @returns Subtree string containing only the focused element and its descendants (empty if not found)
 */
function extractSubtree(tree: string, focusId: string): string {
  const lines = tree.split("\n");
  const result: string[] = [];
  let capturing = false;
  let baseIndent = 0;

  for (const line of lines) {
    if (line.includes(`[${focusId}]`)) {
      capturing = true;
      baseIndent = line.search(/\S/);
      result.push(line);
    } else if (capturing) {
      // Skip empty lines - only check non-empty for subtree boundaries
      if (line.trim() === "") {
        continue;
      }
      const indent = line.search(/\S/);
      // Continue capturing if deeper indent (child of focused element)
      if (indent > baseIndent) {
        result.push(line);
      } else {
        // Hit a sibling or ancestor - exited subtree, stop capturing
        break;
      }
    }
  }
  return result.join("\n");
}

/**
 * Get the cached HybridSnapshot (for use by perform_action).
 */
export function getCachedHybridSnapshot(): HybridSnapshot | null {
  return cachedHybridSnapshot;
}

/**
 * Arguments for get_page_content tool
 */
interface GetPageContentArgs {
  reasoning: string;
  chunkIndex?: number;
  fullPage?: boolean;
  focusElementId?: string;
  searchQuery?: string;
  maxResults?: number;
}

/**
 * Tool for getting the accessibility tree with chunking, search, and focus support.
 *
 * Modes:
 * 1. searchQuery: Search for elements by role/name/text, returns matching IDs only (lightweight)
 * 2. focusElementId: Get subtree of specific element only
 * 3. Default: Get viewport-only tree, chunked if > 40k tokens
 * 4. fullPage: Get full page tree (may be chunked)
 */
export class GetAccessibilityTreeTool implements Tool<
  GetPageContentArgs,
  ChunkedAccessibilityTreeResult | ErrorResult
> {
  name = "get_page_content_v1";
  description =
    "Gets the accessibility tree of the current page. By default returns viewport-only content. Use searchQuery to find elements by role/name/text (lightweight). Use focusElementId to get subtree of a specific element. Large trees are automatically chunked (~30k tokens per chunk).";

  private readonly MAX_TOKENS_PER_CHUNK = 30000;

  async execute(
    args: GetPageContentArgs,
    ctx?: LLMContext,
  ): Promise<ChunkedAccessibilityTreeResult | ErrorResult> {
    try {
      logger.warn(`Getting accessibility tree: ${args.reasoning}`);

      const adapter = await getAdapter(ctx);
      if (!adapter) {
        return { error: "No browser connection available" };
      }

      // MODE 1: Search - lightweight element finding with relevance ranking
      if (args.searchQuery) {
        // Use cached snapshot if available, otherwise capture new one
        const snapshot =
          cachedHybridSnapshot ||
          (await captureHybridSnapshotUniversal(adapter));
        cachedHybridSnapshot = snapshot;

        // Use configurable maxResults (default 20, max 100)
        const maxResults = Math.min(Math.max(args.maxResults || 20, 1), 100);
        const matches = searchAccessibilityTree(
          snapshot.combinedTree,
          args.searchQuery,
          maxResults,
        );
        return {
          simplified: `Found ${matches.length} elements matching "${args.searchQuery}" (ranked by relevance)`,
          matches,
          totalMatches: matches.length,
        };
      }

      // MODE 2: Focus on specific element subtree
      if (args.focusElementId) {
        // Use cached snapshot if available, otherwise capture new one
        const snapshot =
          cachedHybridSnapshot ||
          (await captureHybridSnapshotUniversal(adapter));
        cachedHybridSnapshot = snapshot;

        const subtree = extractSubtree(
          snapshot.combinedTree,
          args.focusElementId,
        );
        if (!subtree || subtree.trim() === "") {
          return {
            error: `Element with ID ${args.focusElementId} not found in accessibility tree`,
          };
        }
        return {
          simplified: subtree,
          focusElementId: args.focusElementId,
          idToUrl: snapshot.combinedUrlMap,
        };
      }

      // MODE 3: Full/viewport tree with automatic chunking
      let snapshot: HybridSnapshot;
      if (args.fullPage) {
        // Full page tree
        snapshot = await captureHybridSnapshotUniversal(adapter);
      } else {
        // Viewport-only tree (default)
        const treeResult = await UtilsUniversal.getAccessibilityTree(adapter);
        // Create a minimal HybridSnapshot-compatible structure for viewport tree
        snapshot = {
          combinedTree: treeResult.simplified,
          combinedXpathMap: treeResult.xpathMap
            ? Object.fromEntries(
                Object.entries(treeResult.xpathMap).map(([k, v]) => [
                  `0-${k}`,
                  v,
                ]),
              )
            : {},
          combinedUrlMap: {},
          perFrame: [],
        };
        // Note: cachedHybridSnapshot is populated lazily when perform_action needs it
      }

      // Cache the snapshot for perform_action to use
      if (args.fullPage) {
        cachedHybridSnapshot = snapshot;
      }

      const tree = snapshot.combinedTree;
      const tokenEstimate = ContentChunker.estimateTokenCount(tree);

      // Chunk if exceeds token limit
      if (tokenEstimate > this.MAX_TOKENS_PER_CHUNK) {
        const chunker = new ContentChunker();
        const chunks = chunker.chunk(tree, {
          strategy: "accessibility-tree",
          maxTokensPerChunk: this.MAX_TOKENS_PER_CHUNK,
        });

        const chunkIndex = args.chunkIndex || 0;
        if (chunkIndex >= chunks.length) {
          return {
            error: `Chunk index ${chunkIndex} out of range. Total chunks: ${chunks.length}`,
          };
        }

        return {
          simplified: chunks[chunkIndex].content,
          chunkIndex,
          totalChunks: chunks.length,
          truncated: true,
          idToUrl: snapshot.combinedUrlMap,
        };
      }

      return {
        simplified: tree,
        idToUrl: snapshot.combinedUrlMap,
      };
    } catch (error) {
      return { error: `Failed to get accessibility tree: ${String(error)}` };
    }
  }

  schema = {
    type: "object",
    properties: {
      reasoning: {
        type: "string",
        description:
          "The reasoning behind why the accessibility tree is needed",
      },
      searchQuery: {
        type: "string",
        description:
          "Search for elements by role, name, or text content. Returns matching elements ranked by relevance (lightweight). Use this to find specific elements without loading the full tree.",
      },
      maxResults: {
        type: "number",
        description:
          "Maximum number of search results to return (default: 20, max: 100). Only applies when searchQuery is used. Higher values may include less relevant matches.",
        minimum: 1,
        maximum: 100,
      },
      focusElementId: {
        type: "string",
        description:
          'EncodedId (e.g., "0-123") of an element to focus on. Returns only that element and its descendants.',
      },
      chunkIndex: {
        type: "number",
        description:
          "Which chunk to retrieve (0-indexed). Only needed when the tree was truncated. Default: 0",
      },
      fullPage: {
        type: "boolean",
        description:
          "Get the full page tree instead of viewport-only. May result in larger output. Default: false",
      },
    },
    required: ["reasoning"],
  };
}

/**
 * Tool for getting the visible accessibility tree (only elements in the viewport)
 */
export class GetVisibleAccessibilityTreeTool implements Tool<
  { reasoning: string },
  AccessibilityTreeResult | ErrorResult
> {
  name = "get_visible_content";
  description =
    "Gets the accessibility tree of only the visible content in the viewport, providing a focused view of what the user can currently see.";

  async execute(
    args: { reasoning: string },
    ctx?: LLMContext,
  ): Promise<AccessibilityTreeResult | ErrorResult> {
    try {
      // Log reasoning for this action
      logger.warn(`Getting visible accessibility tree: ${args.reasoning}`);

      // Get adapter from context (works in both DevTools and eval runner)
      const adapter = await getAdapter(ctx);
      if (!adapter) {
        return { error: "No browser connection available" };
      }

      // Use universal utils with adapter
      const treeResult = await UtilsUniversal.getAccessibilityTree(adapter);
      return {
        simplified: treeResult.simplified,
        iframes: [],
      };
    } catch (error) {
      return {
        error: `Failed to get visible accessibility tree: ${String(error)}`,
      };
    }
  }

  schema = {
    type: "object",
    properties: {
      reasoning: {
        type: "string",
        description:
          "The reasoning behind why the visible accessibility tree is needed",
      },
    },
    required: ["reasoning"],
  };
}

/**
 * Tool for performing actions on DOM elements
 */
export class PerformActionTool implements Tool<
  {
    method: string;
    nodeId: string;
    reasoning: string;
    args?: Record<string, unknown> | unknown[];
  },
  PerformActionResult | ErrorResult
> {
  name = "perform_action";
  description = "Performs an action on a DOM element identified by NodeID";

  async execute(
    args: {
      method: string;
      nodeId: string;
      reasoning: string;
      args?: Record<string, unknown> | unknown[];
    },
    ctx?: LLMContext,
  ): Promise<PerformActionResult | ErrorResult> {
    logger.info("Executing with args:", JSON.stringify(args));
    const method = args.method;
    const nodeId = args.nodeId;

    if (typeof method !== "string") {
      logger.info("Error: Method must be a string");
      return { error: "Method must be a string" };
    }

    if (typeof nodeId !== "string") {
      logger.info("Error: NodeID must be a string (EncodedId format)");
      return {
        error: 'NodeID must be a string in EncodedId format (e.g., "0-123")',
      };
    }

    // Get adapter (works in both DevTools and eval runner)
    const adapter = await getAdapter(ctx);
    if (!adapter) {
      return { error: "No browser connection available" };
    }

    return await this.executeWithAdapter(adapter, args);
  }

  /**
   * Execute action using CDP adapter (for eval runner / Node.js context)
   */
  private async executeWithAdapter(
    adapter: import("../cdp/CDPSessionAdapter.js").CDPSessionAdapter,
    args: {
      method: string;
      nodeId: string;
      reasoning: string;
      args?: Record<string, unknown> | unknown[];
    },
  ): Promise<PerformActionResult | ErrorResult> {
    const { method, nodeId, reasoning } = args;
    let actionArgsArray: unknown[] = [];

    logger.info(
      `PerformActionTool.executeWithAdapter: ${method} on ${nodeId} - ${reasoning}`,
    );

    // Process args (same as existing code)
    if (args.args) {
      if (Array.isArray(args.args)) {
        actionArgsArray = args.args;
      } else if (method === "fill" || method === "type") {
        actionArgsArray = [(args.args as { text: string }).text];
      } else if (method === "selectOption") {
        actionArgsArray = [(args.args as { text: string }).text];
      } else if (method === "setChecked") {
        actionArgsArray = [(args.args as { checked: boolean }).checked];
      } else if (method === "setValue") {
        actionArgsArray = [(args.args as { value: number }).value];
      } else if (method === "drag") {
        actionArgsArray = [args.args];
      } else {
        actionArgsArray = [args.args];
      }
    }

    // Validate EncodedId format (e.g., "0-123" for main frame, "1-456" for iframe)
    if (!isEncodedId(nodeId)) {
      return {
        error: `Invalid nodeId format: "${nodeId}". Use EncodedId format (e.g., "0-123" for main frame, "1-456" for iframe) from the accessibility tree.`,
      };
    }

    const parsed = parseEncodedId(nodeId);
    if (!parsed) {
      return { error: `Invalid EncodedId format: ${nodeId}` };
    }

    logger.info(
      `Executing action on EncodedId ${nodeId}: frame=${parsed.frameOrdinal}, backendNodeId=${parsed.backendNodeId}`,
    );

    try {
      // Use backendNodeId-based action for cross-frame support
      const actionResult = await UtilsUniversal.performActionByBackendNodeId(
        adapter,
        method,
        actionArgsArray,
        parsed.backendNodeId,
        parsed.frameOrdinal,
      );

      return {
        xpath: `backendNodeId:${parsed.backendNodeId}`,
        pageChange: {
          hasChanges: true,
          summary: `Performed ${method} action on element in frame ${parsed.frameOrdinal}`,
          added: [],
          removed: [],
          modified: [],
          hasMore: { added: false, removed: false, modified: false },
        },
        // Include state verification for state-changing actions
        stateVerification: actionResult?.verification,
      };
    } catch (error) {
      logger.error("Action failed for EncodedId:", error);
      return { error: `Action failed for EncodedId ${nodeId}: ${error}` };
    }
  }

  schema = {
    type: "object",
    properties: {
      method: {
        type: "string",
        description:
          "Action to perform (click, rightClick, hover, fill, type, press, focus, scrollIntoView, selectOption, check, uncheck, setChecked, drag, setValue)",
        enum: [
          "click",
          "rightClick",
          "hover",
          "fill",
          "type",
          "press",
          "focus",
          "scrollIntoView",
          "selectOption",
          "check",
          "uncheck",
          "setChecked",
          "drag",
          "setValue",
        ],
      },
      nodeId: {
        type: "string",
        description:
          'EncodedId of the element from the accessibility tree (format: "frameOrdinal-backendNodeId", e.g., "0-123" for main frame, "1-456" for iframe). Always use the exact EncodedId shown in square brackets in the accessibility tree output.',
      },
      args: {
        oneOf: [
          {
            type: "object",
            description:
              'Arguments for the action. For "fill"/"type", requires an object like { "text": "value" }. For "selectOption", requires an object like { "text": "option_value" }. For "setChecked", requires an object like { "checked": true/false }. For "setValue", requires an object like { "value": 75 } (numeric for sliders/range inputs). For "drag", requires an object with either relative offset { "offsetX": 100, "offsetY": 0 } or absolute position { "toX": 500, "toY": 200 }. For "press", requires an array like ["key"]. Other methods (click, hover, check, uncheck, scrollIntoView) typically do not use args.',
            properties: {
              text: {
                type: "string",
                description:
                  "The text value to fill, type, or select option value.",
              },
              checked: {
                type: "boolean",
                description:
                  "For setChecked method - whether the checkbox should be checked (true) or unchecked (false).",
              },
              value: {
                type: "number",
                description:
                  "For setValue method - the numeric value to set on a slider or range input. The value will be clamped to the element's min/max range.",
              },
              offsetX: {
                type: "number",
                description:
                  "For drag method - horizontal offset in pixels (relative to element center). Positive moves right, negative moves left.",
              },
              offsetY: {
                type: "number",
                description:
                  "For drag method - vertical offset in pixels (relative to element center). Positive moves down, negative moves up.",
              },
              toX: {
                type: "number",
                description:
                  "For drag method - absolute X coordinate to drag to (alternative to offsetX).",
              },
              toY: {
                type: "number",
                description:
                  "For drag method - absolute Y coordinate to drag to (alternative to offsetY).",
              },
            },
          },
          {
            type: "array",
            description:
              'Arguments for the action. For "press", requires an array like ["key"].',
            items: {
              type: "string",
            },
          },
        ],
      },
      reasoning: {
        type: "string",
        description:
          "Reasoning for the action. This is a free form text field that will be used to explain the action to the user.",
      },
    },
    required: ["method", "nodeId", "reasoning"],
  };

  // Tree diff methods for action verification
  private getTreeDiff(
    before: string,
    after: string,
  ): {
    hasChanges: boolean;
    added: string[];
    removed: string[];
    modified: string[];
    summary: string;
  } {
    if (before === after) {
      return {
        hasChanges: false,
        added: [],
        removed: [],
        modified: [],
        summary: "No changes detected in page structure",
      };
    }

    const beforeLines = before.split("\n").filter((line) => line.trim());
    const afterLines = after.split("\n").filter((line) => line.trim());

    const lcs = this.findLCS(beforeLines, afterLines);

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    afterLines.forEach((line) => {
      if (!lcs.includes(line)) {
        added.push(line);
      }
    });

    beforeLines.forEach((line) => {
      if (!lcs.includes(line)) {
        removed.push(line);
      }
    });

    this.findModifications(beforeLines, afterLines, added, removed, modified);

    const summary = `${added.length} added, ${removed.length} removed, ${modified.length} modified`;

    return {
      hasChanges: true,
      added,
      removed,
      modified,
      summary,
    };
  }

  private findLCS(a: string[], b: string[]): string[] {
    const m = a.length;
    const n = b.length;
    const dp = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const lcs: string[] = [];
    let i = m,
      j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        lcs.unshift(a[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return lcs;
  }

  private findModifications(
    before: string[],
    after: string[],
    added: string[],
    removed: string[],
    modified: string[],
  ): void {
    for (const removedLine of [...removed]) {
      for (const addedLine of [...added]) {
        if (this.areSimilar(removedLine, addedLine)) {
          modified.push(`${removedLine} → ${addedLine}`);
          const addedIndex = added.indexOf(addedLine);
          const removedIndex = removed.indexOf(removedLine);
          if (addedIndex > -1) added.splice(addedIndex, 1);
          if (removedIndex > -1) removed.splice(removedIndex, 1);
          break;
        }
      }
    }
  }

  private areSimilar(line1: string, line2: string): boolean {
    const nodePattern = /\[(\d+)\]\s+(\w+)/;
    const match1 = line1.match(nodePattern);
    const match2 = line2.match(nodePattern);

    if (match1 && match2) {
      return match1[2] === match2[2] && match1[1] !== match2[1];
    }

    const similarity = this.calculateSimilarity(line1, line2);
    return similarity > 0.7;
  }

  private calculateSimilarity(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const maxLen = Math.max(len1, len2);

    if (maxLen === 0) return 1;

    const distance = this.editDistance(str1, str2);
    return 1 - distance / maxLen;
  }

  private editDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }

    return dp[m][n];
  }
}

/**
 * NEW TOOL: ObjectiveDrivenActionTool
 */
// Tree diff interfaces for ObjectiveDrivenActionTool
interface TreeDiffResult {
  hasChanges: boolean;
  added: string[];
  removed: string[];
  modified: string[];
  summary: string;
}

export class ObjectiveDrivenActionTool implements Tool<
  {
    objective: string;
    offset?: number;
    chunkSize?: number;
    maxRetries?: number;
  },
  ObjectiveDrivenActionResult | ErrorResult
> {
  name = "objective_driven_action";
  description =
    "Analyzes the page's accessibility tree to fulfill a delegated action objective. Performs actions (e.g., click, fill) using accessibility IDs. Identifies the best element to interact with based on the context and objectives. Acts as a specialized sub-agent with retries.";

  // Tree diff methods
  private getTreeDiff(before: string, after: string): TreeDiffResult {
    if (before === after) {
      return {
        hasChanges: false,
        added: [],
        removed: [],
        modified: [],
        summary: "No changes detected in page structure",
      };
    }

    const beforeLines = before.split("\n").filter((line) => line.trim());
    const afterLines = after.split("\n").filter((line) => line.trim());

    // Simple Myers-inspired diff using LCS (Longest Common Subsequence)
    const lcs = this.findLCS(beforeLines, afterLines);

    // Find added and removed lines
    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    // Lines in 'after' but not in LCS are added
    afterLines.forEach((line) => {
      if (!lcs.includes(line)) {
        added.push(line);
      }
    });

    // Lines in 'before' but not in LCS are removed
    beforeLines.forEach((line) => {
      if (!lcs.includes(line)) {
        removed.push(line);
      }
    });

    // Detect modifications (similar lines that changed)
    this.findModifications(beforeLines, afterLines, added, removed, modified);

    const summary = `${added.length} added, ${removed.length} removed, ${modified.length} modified`;

    return {
      hasChanges: true,
      added,
      removed,
      modified,
      summary,
    };
  }

  // Simple LCS implementation for diff
  private findLCS(a: string[], b: string[]): string[] {
    const m = a.length;
    const n = b.length;
    const dp = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    // Build LCS table
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Reconstruct LCS
    const lcs: string[] = [];
    let i = m,
      j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        lcs.unshift(a[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return lcs;
  }

  // Detect modifications (lines that are similar but changed)
  private findModifications(
    before: string[],
    after: string[],
    added: string[],
    removed: string[],
    modified: string[],
  ): void {
    // Look for similar lines that might be modifications
    for (const removedLine of removed) {
      for (const addedLine of added) {
        if (this.areSimilar(removedLine, addedLine)) {
          modified.push(`${removedLine} → ${addedLine}`);
          // Remove from added/removed since they're modifications
          const addedIndex = added.indexOf(addedLine);
          const removedIndex = removed.indexOf(removedLine);
          if (addedIndex > -1) added.splice(addedIndex, 1);
          if (removedIndex > -1) removed.splice(removedIndex, 1);
          break;
        }
      }
    }
  }

  // Simple similarity check for accessibility tree lines
  private areSimilar(line1: string, line2: string): boolean {
    // Extract node type and check if they're the same element with different content
    const nodePattern = /\[(\d+)\]\s+(\w+)/;
    const match1 = line1.match(nodePattern);
    const match2 = line2.match(nodePattern);

    if (match1 && match2) {
      // Same element type but different content might be a modification
      return match1[2] === match2[2] && match1[1] !== match2[1];
    }

    // Fallback: check if lines are 70% similar
    const similarity = this.calculateSimilarity(line1, line2);
    return similarity > 0.7;
  }

  private calculateSimilarity(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const maxLen = Math.max(len1, len2);

    if (maxLen === 0) return 1;

    // Simple edit distance calculation
    const distance = this.editDistance(str1, str2);
    return 1 - distance / maxLen;
  }

  private editDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }

    return dp[m][n];
  }

  // Create system prompt for ObjectiveDrivenActionTool
  private getSystemPrompt(): string {
    return `You are an expert assistant for Browser Operator, specializing in analyzing web page accessibility trees and determining the most appropriate browser actions to satisfy objectives delegated by another AI agent.

Your task is to examine the provided simplified accessibility tree, which contains element structures with their accessibility IDs in brackets, and determine the appropriate action to take based on the delegated objective. You must determine the target element (nodeIdString), the action method, and any necessary arguments. Then respond using the provided tool format.

Handling different action types:
*   For clicks: Find the most relevant interactive element (button, link, menu item)
*   For filling forms: Identify the correct input field
*   For complex interactions: Determine the precise sequence needed

Handle edge cases:
- When in doubt about performing an action, set the error field instead of guessing incorrectly.
- If no suitable element exists for the requested action, clearly explain why in an error message.

Important guidelines:
- Be precise when extracting nodeIdString for actions.
- Only include 'args' for relevant actions (fill, type, press).
- Prefer the most direct path to accomplishing the objective.
- Choose the most semantically appropriate element when multiple options exist.`;
  }

  async execute(
    args: {
      objective: string;
      offset?: number;
      chunkSize?: number;
      maxRetries?: number;
    },
    ctx?: LLMContext,
  ): Promise<ObjectiveDrivenActionResult | ErrorResult> {
    const { objective, offset = 0, chunkSize = 60000, maxRetries = 1 } = args; // Default offset 0, chunkSize 60000, maxRetries 1
    let currentTry = 0;
    let lastError: string | null = null;

    // Get API key from context first (for eval runner), fallback to AgentService
    let apiKey = ctx?.apiKey;
    if (!apiKey && !isNodeEnvironment) {
      await ensureToolsBrowserDeps();
      if (AgentService) {
        apiKey = AgentService.getInstance().getApiKey() ?? undefined;
      }
    }
    const providerForAction = ctx?.provider;
    const modelNameForAction = ctx?.miniModel || ctx?.model;
    if (!providerForAction || !modelNameForAction) {
      return {
        error:
          "Missing LLM context (provider/model) for ObjectiveDrivenActionTool",
      };
    }

    // LiteLLM and BrowserOperator have optional API keys
    const requiresApiKey =
      providerForAction !== "litellm" &&
      providerForAction !== "browseroperator";

    if (requiresApiKey && !apiKey) {
      return { error: "API key not configured." };
    }
    if (typeof objective !== "string" || objective.trim() === "") {
      return { error: "Objective must be a non-empty string" };
    }

    // --- Internal Agentic Loop ---
    while (currentTry <= maxRetries) {
      currentTry++;
      logger.info(
        `ObjectiveDrivenActionTool: Attempt ${currentTry}/${maxRetries + 1} for objective: "${objective}"`,
      );
      let attemptError: Error | null = null; // Use Error object for better stack traces

      try {
        // --- Step 1: Get Tree ---
        logger.info("ObjectiveDrivenActionTool: Getting Accessibility Tree...");
        const getAccTreeTool = new GetAccessibilityTreeTool();
        const treeResult = await getAccTreeTool.execute(
          { reasoning: `Attempt ${currentTry} for objective: ${objective}` },
          ctx,
        );
        if ("error" in treeResult) {
          throw new Error(`Tree Error: ${treeResult.error}`);
        }
        const accessibilityTreeString = treeResult.simplified;
        if (!accessibilityTreeString || accessibilityTreeString.trim() === "") {
          throw new Error("Tree Error: Empty or blank tree content.");
        }
        logger.info("ObjectiveDrivenActionTool: Got Accessibility Tree.");

        // --- Step 2: LLM - Determine Action (Method, Accessibility NodeID String, Args) ---
        logger.info("ObjectiveDrivenActionTool: Determining Action via LLM...");

        // Create PerformActionTool to use its schema
        const performActionTool = new PerformActionTool();

        const promptGetAction = `
User Objective: "${objective}"

Full tree length: ${accessibilityTreeString.length} chars. Showing chars ${offset}-${offset + chunkSize}:
Simplified Accessibility Tree Chunk:
\`\`\`
${accessibilityTreeString.substring(offset, offset + chunkSize)}
\`\`\`
${accessibilityTreeString.length > offset + chunkSize ? `...(tree truncated at ${offset + chunkSize}/${accessibilityTreeString.length})...` : ""}
${lastError ? `Previous attempt failed with this error: "${lastError}". Consider a different approach.` : ""}
Based on the objective and the simplified accessibility tree chunk, determine the target element, the action method, the accessibility nodeId string, and any necessary arguments. Then respond using the provided tool format.

Handling different action types:
*   For clicks: Find the most relevant interactive element (button, link, menu item)
*   For filling forms: Identify the correct input field
*   For complex interactions: Determine the precise sequence needed

Handle edge cases:
- When in doubt about performing an action, set the error field instead of guessing incorrectly.
- If no suitable element exists for the requested action, clearly explain why in an error message.

Important guidelines:
- Be precise when extracting nodeIdString for actions.
- Only include 'args' for relevant actions (fill, type, press).
- Prefer the most direct path to accomplishing the objective.
- Choose the most semantically appropriate element when multiple options exist.`;

        // Use LLMClient with function call support
        const llm = LLMClient.getInstance();
        const llmResponse = await llm.call({
          provider: providerForAction,
          model: modelNameForAction,
          messages: [
            { role: "system", content: this.getSystemPrompt() },
            { role: "user", content: promptGetAction },
          ],
          systemPrompt: this.getSystemPrompt(),
          tools: [
            {
              type: "function",
              function: {
                name: performActionTool.name,
                description: performActionTool.description,
                parameters: performActionTool.schema,
              },
            },
          ],
          temperature: 0.4,
          retryConfig: { maxRetries: 3, baseDelayMs: 2000 },
        });

        // Convert LLMResponse to expected format
        const response = {
          text: llmResponse.text,
          functionCall: llmResponse.functionCall,
        };

        // --- Parse the Tool Call Response ---
        if (
          !response.functionCall ||
          response.functionCall.name !== performActionTool.name
        ) {
          logger.warn(
            "LLM did not return the expected function call; this is likely an error",
            response,
          );
          const errorMessage =
            response.text ||
            "No function call returned - this tool requires a function call response.";

          // Since this tool specifically handles actions, if we didn't get a function call
          // we should return an error instead of text content
          return {
            error: `Failed to determine appropriate action: ${errorMessage}`,
          };
        }
        const {
          method: actionMethod,
          nodeId: accessibilityNodeId,
          args: actionArgs,
        } = response.functionCall.arguments as {
          method: string;
          nodeId: string;
          args?: Record<string, unknown> | unknown[];
        };
        logger.info("Parsed Tool Arguments:", {
          actionMethod,
          accessibilityNodeId,
          actionArgs,
        });

        const actionNodeId = String(accessibilityNodeId);
        logger.info(
          `ObjectiveDrivenActionTool: Performing action '${actionMethod}' on NodeID ${actionNodeId}...`,
        );

        // --- Capture tree state before action ---
        const adapter = await getAdapter(ctx);
        let treeBeforeAction = "";
        let treeAfterAction = "";
        let treeDiff: TreeDiffResult | null = null;

        try {
          if (adapter) {
            const beforeTreeResult =
              await UtilsUniversal.getAccessibilityTree(adapter);
            treeBeforeAction = beforeTreeResult.simplified;
            logger.debug("Captured accessibility tree before action");
          }
        } catch (error) {
          logger.warn("Failed to capture tree before action:", error);
        }

        const performResult = await performActionTool.execute(
          {
            method: actionMethod,
            nodeId: actionNodeId,
            args: actionArgs,
            reasoning: `Attempt ${currentTry} for objective: ${objective}`,
          },
          ctx,
        );
        if ("error" in performResult) {
          // Throw error to be caught by the loop's catch block
          throw new Error(
            `Action Error (NodeID ${actionNodeId}): ${performResult.error}`,
          );
        }

        // --- Capture tree state after action and generate diff ---
        try {
          if (adapter && treeBeforeAction) {
            const afterTreeResult =
              await UtilsUniversal.getAccessibilityTree(adapter);
            treeAfterAction = afterTreeResult.simplified;

            // Generate tree diff
            treeDiff = this.getTreeDiff(treeBeforeAction, treeAfterAction);

            logger.info(`Tree diff after ${actionMethod}:`, treeDiff.summary);
            if (treeDiff.hasChanges) {
              logger.debug("Tree changes:", {
                added: treeDiff.added.slice(0, 3),
                removed: treeDiff.removed.slice(0, 3),
                modified: treeDiff.modified.slice(0, 3),
              });
            } else {
              logger.warn(
                `No tree changes detected after ${actionMethod} - action may have failed or had no visible effect`,
              );
            }
          }
        } catch (error) {
          logger.warn("Failed to capture tree after action:", error);
        }

        logger.info(
          "ObjectiveDrivenActionTool: Action successful (but may have affected unexpected element).",
        );

        // Fetch page metadata
        let metadata: { url: string; title: string } | undefined;
        if (adapter) {
          const runtimeAgent = adapter.runtimeAgent();
          const metadataEval = await runtimeAgent.invoke<{
            result?: { value?: { url: string; title: string } };
          }>("evaluate", {
            expression:
              "({ url: window.location.href, title: document.title })",
            returnByValue: true,
          });
          metadata = metadataEval.result?.value as {
            url: string;
            title: string;
          };
        }

        return {
          success: true,
          message: `Successfully executed action for objective "${objective}"`,
          finalAction: {
            method: actionMethod,
            nodeId: actionNodeId,
            args: actionArgs,
          },
          method: actionMethod,
          nodeId: actionNodeId,
          args: actionArgs,
          processedLength: offset + chunkSize,
          totalLength: accessibilityTreeString.length,
          truncated: accessibilityTreeString.length > offset + chunkSize,
          metadata,
          treeDiff: treeDiff
            ? {
                hasChanges: treeDiff.hasChanges,
                summary: treeDiff.summary,
                added: treeDiff.added.slice(0, 5),
                removed: treeDiff.removed.slice(0, 5),
                modified: treeDiff.modified.slice(0, 5),
                hasMore: {
                  added: treeDiff.added.length > 5,
                  removed: treeDiff.removed.length > 5,
                  modified: treeDiff.modified.length > 5,
                },
              }
            : null,
        };
      } catch (error) {
        // Catch errors from any step within the try block
        attemptError = error as Error;
        logger.warn(
          `ObjectiveDrivenActionTool: Attempt ${currentTry} failed:`,
          attemptError.message,
        );
        lastError = attemptError.message; // Store error message for the next attempt's prompt
        // Optional: Add a small delay before retrying? await new Promise(resolve => setTimeout(resolve, 500));
      }
    } // End while loop

    // If loop finishes without success (i.e., all retries failed)
    return {
      error: `Failed objective "${objective}" after ${currentTry} attempts. Last error: ${lastError || "Unknown error during final attempt."}`,
    };
  }

  schema = {
    type: "object",
    properties: {
      objective: {
        type: "string",
        description:
          'The high-level objective the user wants to achieve on the page (e.g., "click the login button", "fill the search box with \'test\' and press Enter"). Be specific.',
      },
      offset: {
        type: "number",
        description: "Offset for the accessibility tree chunk (default: 0)",
        default: 0,
      },
      chunkSize: {
        type: "number",
        description: "Size of the accessibility tree chunk (default: 60000)",
        default: 60000,
      },
      maxRetries: {
        type: "number",
        description:
          "Maximum number of retries if an attempt fails (default: 1, meaning 2 total attempts).",
        default: 1,
      },
    },
    required: ["objective"],
  };
}

/**
 * Tool for getting URLs from a list of NodeIDs
 */
export class NodeIDsToURLsTool implements Tool<
  { nodeIds: string[] },
  NodeIDsToURLsResult | ErrorResult
> {
  name = "node_ids_to_urls";
  description =
    "Gets URLs associated with DOM elements identified by EncodedIds from accessibility tree.";

  async execute(
    args: { nodeIds: string[] },
    ctx?: LLMContext,
  ): Promise<NodeIDsToURLsResult | ErrorResult> {
    if (!Array.isArray(args.nodeIds)) {
      return {
        error:
          'nodeIds must be an array of EncodedId strings (e.g., ["0-123", "0-456"])',
      };
    }

    if (args.nodeIds.length === 0) {
      return { error: "nodeIds array must not be empty" };
    }

    // Get adapter from context (works in both DevTools and eval runner)
    const adapter = await getAdapter(ctx);
    if (!adapter) {
      return { error: "No browser connection available" };
    }

    const results: Array<{ nodeId: string; url?: string }> = [];
    const runtimeAgent = adapter.runtimeAgent();

    // Process each nodeId separately
    for (const nodeId of args.nodeIds) {
      try {
        let backendNodeId: number;

        // Handle EncodedId format (e.g., "0-123")
        if (!isEncodedId(nodeId)) {
          results.push({ nodeId });
          continue;
        }
        const parsed = parseEncodedId(nodeId);
        if (!parsed) {
          results.push({ nodeId });
          continue;
        }
        backendNodeId = parsed.backendNodeId;

        // First, get the xpath for the node using universal utils
        const xpath = await UtilsUniversal.getXPathByBackendNodeId(
          adapter,
          backendNodeId,
        );
        if (!xpath) {
          results.push({ nodeId });
          continue;
        }

        // Execute JavaScript to get the URL from the element
        const evaluateResult = await runtimeAgent.invoke<{
          result?: { value?: { found: boolean; url?: string } };
          exceptionDetails?: unknown;
        }>("evaluate", {
          expression: `
            (function() {
              const element = document.evaluate("${xpath}", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
              if (!element) return { found: false };

              // Try to get href for anchor tags
              if (element instanceof HTMLAnchorElement && element.href) {
                return { found: true, url: element.href };
              }

              // Try to find closest anchor parent
              let closestAnchor = element.closest('a[href]');
              if (closestAnchor && closestAnchor.href) {
                return { found: true, url: closestAnchor.href };
              }

              return { found: false };
            })()
          `,
          returnByValue: true,
        });

        if (evaluateResult.exceptionDetails) {
          logger.warn("Error evaluating URL for NodeID", {
            nodeId,
            details: evaluateResult.exceptionDetails,
          });
          results.push({ nodeId });
          continue;
        }

        const resultValue = evaluateResult.result?.value;
        if (resultValue?.found && resultValue.url) {
          results.push({ nodeId, url: resultValue.url });
        } else {
          results.push({ nodeId });
        }
      } catch (error) {
        logger.warn("Error processing NodeID", {
          nodeId,
          error: error instanceof Error ? error.message : String(error),
        });
        results.push({ nodeId });
      }
    }

    return {
      urls: results,
    };
  }

  schema = {
    type: "object",
    properties: {
      nodeIds: {
        type: "array",
        description:
          'Array of EncodedIds from the accessibility tree to get URLs for (e.g., ["0-123", "0-456"])',
        items: {
          type: "string",
        },
      },
    },
    required: ["nodeIds"],
  };
}

// Create interfaces for the visit history tool results
export interface VisitHistoryDomainResult {
  visits: Array<{
    url: string;
    title: string;
    visitTime: string;
    keywords: string[];
  }>;
  count: number;
  error?: string;
}

export interface VisitHistoryKeywordResult {
  visits: Array<{
    url: string;
    title: string;
    visitTime: string;
    domain: string;
    keywords: string[];
  }>;
  count: number;
  error?: string;
}

export interface VisitHistorySearchResult {
  visits: Array<{
    url: string;
    title: string;
    visitTime: string;
    domain: string;
    keywords: string[];
  }>;
  count: number;
  filters: {
    domain?: string;
    keyword?: string;
    daysAgo?: number;
    limit?: number;
  };
  error?: string;
}

// Create proper classes for tools that implement the Tool interface
export class GetVisitsByDomainTool implements Tool<
  { domain: string },
  VisitHistoryDomainResult | ErrorResult
> {
  name = "get_visits_by_domain";
  description = "Get a list of visited pages filtered by domain name";

  async execute(
    args: { domain: string },
    _ctx?: LLMContext,
  ): Promise<VisitHistoryDomainResult | ErrorResult> {
    try {
      const visits = await VisitHistoryManager.getInstance().getVisitsByDomain(
        args.domain,
      );

      return {
        visits: visits.map((visit: VisitData) => ({
          url: visit.url,
          title: visit.title,
          visitTime: new Date(visit.timestamp).toLocaleString(),
          keywords: visit.keywords,
        })),
        count: visits.length,
      };
    } catch (error) {
      return {
        error: String(error),
        visits: [],
        count: 0,
      };
    }
  }

  schema = {
    type: "object",
    properties: {
      domain: {
        type: "string",
        description: 'The domain name to filter by (e.g., "example.com")',
      },
    },
    required: ["domain"],
  };
}

export class GetVisitsByKeywordTool implements Tool<
  { keyword: string },
  VisitHistoryKeywordResult | ErrorResult
> {
  name = "get_visits_by_keyword";
  description = "Get a list of visited pages containing a specific keyword";

  async execute(
    args: { keyword: string },
    _ctx?: LLMContext,
  ): Promise<VisitHistoryKeywordResult | ErrorResult> {
    try {
      const visits = await VisitHistoryManager.getInstance().getVisitsByKeyword(
        args.keyword,
      );

      return {
        visits: visits.map((visit: VisitData) => ({
          url: visit.url,
          title: visit.title,
          visitTime: new Date(visit.timestamp).toLocaleString(),
          domain: visit.domain,
          keywords: visit.keywords,
        })),
        count: visits.length,
      };
    } catch (error) {
      return {
        error: `Failed to get visits for keyword ${args.keyword}: ${error}`,
      };
    }
  }

  schema = {
    type: "object",
    properties: {
      keyword: {
        type: "string",
        description: "The keyword to search for in page content",
      },
    },
    required: ["keyword"],
  };
}

export class SearchVisitHistoryTool implements Tool<
  {
    domain?: string;
    keyword?: string;
    daysAgo?: number;
    limit?: number;
  },
  VisitHistorySearchResult | ErrorResult
> {
  name = "search_visit_history";
  description = "Search browsing history with multiple filter criteria";

  async execute(
    args: {
      domain?: string;
      keyword?: string;
      daysAgo?: number;
      limit?: number;
    },
    _ctx?: LLMContext,
  ): Promise<VisitHistorySearchResult | ErrorResult> {
    try {
      const { domain, keyword, daysAgo, limit } = args;

      // Calculate time range if daysAgo is provided
      let startTime: number | undefined;
      let endTime: number | undefined;

      if (daysAgo !== undefined) {
        const now = Date.now();
        startTime = now - daysAgo * 24 * 60 * 60 * 1000;
        endTime = now;
      }

      const visits = await VisitHistoryManager.getInstance().searchVisits({
        domain,
        keyword,
        startTime,
        endTime,
        limit,
      });

      return {
        visits: visits.map((visit) => ({
          url: visit.url,
          title: visit.title,
          visitTime: new Date(visit.timestamp).toLocaleString(),
          domain: visit.domain,
          keywords: visit.keywords,
        })),
        count: visits.length,
        filters: {
          domain,
          keyword,
          daysAgo,
          limit,
        },
      };
    } catch (error) {
      return { error: `Failed to search visit history: ${error}` };
    }
  }

  schema = {
    type: "object",
    properties: {
      domain: {
        type: "string",
        description: "Optional domain filter",
      },
      keyword: {
        type: "string",
        description: "Optional keyword filter",
      },
      daysAgo: {
        type: "number",
        description: "Optional filter for how many days back to search",
      },
      limit: {
        type: "number",
        description: "Optional limit on number of results (default 100)",
      },
    },
  };
}

/**
 * Returns all available tools
 */
export function getTools(): Array<
  | Tool<{ selector: string }, ElementInspectionResult | ErrorResult>
  | Tool<{ url?: string; limit?: number }, NetworkAnalysisResult | ErrorResult>
  | Tool<{ code: string }, JavaScriptExecutionResult | ErrorResult>
  | Tool<{ limit?: number; level?: string }, ConsoleLogsResult | ErrorResult>
  | Tool<{ url: string; reasoning: string }, NavigationResult | ErrorResult>
  | Tool<{ steps: number; reasoning: string }, NavigateBackResult | ErrorResult>
  | Tool<
      {
        objective: string;
        offset?: number;
        chunkSize?: number;
        maxRetries?: number;
      },
      ObjectiveDrivenActionResult | ErrorResult
    >
  | Tool<
      {
        objective: string;
        schema: Record<string, unknown>;
        offset?: number;
        chunkSize?: number;
        maxRetries?: number;
      },
      SchemaBasedDataExtractionResult | ErrorResult
    >
  | Tool<
      {
        schema: SchemaDefinition;
        instruction?: string;
        selectorOrXPath?: string;
      },
      SchemaExtractionResult | ErrorResult
    >
  | Tool<Record<string, unknown>, PageHTMLResult | ErrorResult>
  | Tool<Record<string, unknown>, DevToolsContext | ErrorResult>
  | Tool<{ selector: string }, ClickElementResult | ErrorResult>
  | Tool<{ query: string; limit?: number }, SearchContentResult | ErrorResult>
  | Tool<
      {
        position?: { x: number; y: number };
        direction?: string;
        amount?: number;
      },
      ScrollResult | ErrorResult
    >
  | Tool<{ reasoning: string }, AccessibilityTreeResult | ErrorResult>
  | Tool<
      {
        method: string;
        nodeId: string;
        reasoning: string;
        args?: Record<string, unknown> | unknown[];
      },
      PerformActionResult | ErrorResult
    >
  | Tool<
      Record<string, unknown>,
      FullPageAccessibilityTreeToMarkdownResult | ErrorResult
    >
  | Tool<{ nodeIds: string[] }, NodeIDsToURLsResult | ErrorResult>
  | Tool<
      { reasoning: string; instruction?: string },
      HTMLToMarkdownResult | ErrorResult
    >
  | Tool<
      {
        url: string;
        reasoning: string;
        schema?: SchemaDefinition;
        markdownResponse?: boolean;
        extractionInstruction?: string;
      },
      CombinedExtractionResult | ErrorResult
    >
  | Tool<FetcherToolArgs, FetcherToolResult>
  | Tool<{ answer: string }, FinalizeWithCritiqueResult>
  | Tool<{ domain: string }, VisitHistoryDomainResult | ErrorResult>
  | Tool<{ keyword: string }, VisitHistoryKeywordResult | ErrorResult>
  | Tool<
      { domain?: string; keyword?: string; daysAgo?: number; limit?: number },
      VisitHistorySearchResult | ErrorResult
    >
  | Tool<{ seconds: number; reason?: string }, WaitResult | ErrorResult>
  | Tool<SequentialThinkingArgs, SequentialThinkingResult | ErrorResult>
> {
  return [
    new ExecuteJavaScriptTool(),
    new NetworkAnalysisTool(),
    new GetPageHTMLTool(),
    new ClickElementTool(),
    new SearchContentTool(),
    new ScrollPageTool(),
    new NavigateURLTool(),
    new NavigateBackTool(),
    new GetAccessibilityTreeTool(),
    new GetVisibleAccessibilityTreeTool(),
    new NodeIDsToURLsTool(),
    new SchemaBasedExtractorTool(),
    new HTMLToMarkdownTool(),
    new FullPageAccessibilityTreeToMarkdownTool(),
    new CombinedExtractionTool(),
    new FetcherTool(),
    new FinalizeWithCritiqueTool(),
    new GetVisitsByDomainTool(),
    new GetVisitsByKeywordTool(),
    new SearchVisitHistoryTool(),
    new WaitTool(),
    new SequentialThinkingTool(),
  ];
}

// Export the SequentialThinkingTool
export { SequentialThinkingTool } from "./SequentialThinkingTool.js";

// Export HTML injection tools
export { RenderWebAppTool } from "./RenderWebAppTool.js";
export type {
  RenderWebAppArgs,
  RenderWebAppResult,
} from "./RenderWebAppTool.js";
export { GetWebAppDataTool } from "./GetWebAppDataTool.js";
export type {
  GetWebAppDataArgs,
  GetWebAppDataResult,
} from "./GetWebAppDataTool.js";
export { RemoveWebAppTool } from "./RemoveWebAppTool.js";
export type {
  RemoveWebAppArgs,
  RemoveWebAppResult,
} from "./RemoveWebAppTool.js";

// Export visual indicator manager
export { VisualIndicatorManager } from "./VisualIndicatorTool.js";

// Export ReadabilityExtractorTool
export { ReadabilityExtractorTool } from "./ReadabilityExtractorTool.js";
export type {
  ReadabilityExtractorArgs,
  ReadabilityExtractorResult,
} from "./ReadabilityExtractorTool.js";

export { CreateFileTool } from "./CreateFileTool.js";
export type { CreateFileArgs, CreateFileResult } from "./CreateFileTool.js";
export { UpdateFileTool } from "./UpdateFileTool.js";
export type { UpdateFileArgs, UpdateFileResult } from "./UpdateFileTool.js";
export { DeleteFileTool } from "./DeleteFileTool.js";
export type { DeleteFileArgs, DeleteFileResult } from "./DeleteFileTool.js";
export { ReadFileTool } from "./ReadFileTool.js";
export type { ReadFileArgs, ReadFileResult } from "./ReadFileTool.js";
export { ListFilesTool } from "./ListFilesTool.js";
export type { ListFilesArgs, ListFilesResult } from "./ListFilesTool.js";
export { ExecuteCodeTool } from "./ExecuteCodeTool.js";
export type { ExecuteCodeArgs } from "./ExecuteCodeTool.js";
// Abortable sleep utility for tools that need delays/polling
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (!ms) return resolve();
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException("The operation was aborted", "AbortError"));
    };
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        cleanup();
        return reject(
          new DOMException("The operation was aborted", "AbortError"),
        );
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
