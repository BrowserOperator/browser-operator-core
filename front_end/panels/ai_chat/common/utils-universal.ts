/**
 * Universal Utils - CDP-adapter compatible utility functions
 *
 * These functions work with both DevTools SDK and direct CDP connections
 * by using the CDPSessionAdapter interface.
 *
 * Usage:
 * - In DevTools: new SDKTargetAdapter(target)
 * - In eval runner: new DirectCDPAdapter(chromeRemoteInterfaceClient)
 */

import type {CDPSessionAdapter} from '../cdp/CDPSessionAdapter.js';
import {FrameRegistryUniversal} from '../cdp/FrameRegistryUniversal.js';
import type {AccessibilityNode, TreeResult, BackendIdMaps, EncodedId} from './context.js';
import {makeEncodedId} from './context.js';
import {XPATH_BUILDER_FUNCTION_STRING} from './xpath-builder.js';
import {getQuadCenter} from './geometry-helpers.js';
import {
  getElementCenterFromObjectId,
  getElementCenterFromBackendNodeId,
  dispatchClick,
  dispatchMouseMove,
  dispatchDrag,
} from './mouse-helpers.js';
import {createLogger} from '../core/Logger.js';

const logger = createLogger('utils-universal');

// ============================================================================
// Constants
// ============================================================================

/** Maximum time to wait for element position to stabilize after scroll */
const SCROLL_STABILIZATION_TIMEOUT_MS = 1000;

/** Interval for checking if element position has stabilized */
const POSITION_CHECK_INTERVAL_MS = 50;

// ============================================================================
// Tree Formatting Functions (pure functions, no CDP needed)
// ============================================================================

/**
 * Formats an accessibility node tree into a simplified string representation
 */
export function formatSimplifiedTree(node: AccessibilityNode, level = 0): string {
  const indent = '  '.repeat(level);
  let result = `${indent}[${node.nodeId}] ${node.role}${node.name ? `: ${node.name}` : ''}\n`;

  if (node.children?.length) {
    result += node.children.map(child => formatSimplifiedTree(child, level + 1)).join('');
  }
  return result;
}

/**
 * Helper function to recursively build a subtree from a flat list of nodes.
 */
function buildSubtreeRecursive(
    nodeId: string,
    nodeMap: Map<string, AccessibilityNode>,
): AccessibilityNode|null {
  const nodeIdNum = parseInt(nodeId, 10);
  if (isNaN(nodeIdNum) || nodeIdNum < 0) {
    return null;
  }

  const currentNode = nodeMap.get(nodeId);
  if (!currentNode) {
    return null;
  }

  const newNode: AccessibilityNode = {
    ...currentNode,
    children: [],
  };

  if (currentNode.childIds && currentNode.childIds.length > 0) {
    newNode.children = currentNode.childIds
                           .map(childId => buildSubtreeRecursive(childId, nodeMap))
                           .filter((child): child is AccessibilityNode => child !== null);
  }

  delete newNode.childIds;
  delete newNode.parentId;

  return newNode;
}

// ============================================================================
// Backend ID Maps
// ============================================================================

/**
 * Builds backend ID mappings for DOM nodes.
 * Returns tagNameMap (backendNodeId -> tagName) and xpathMap (backendNodeId -> xpath).
 */
export async function buildBackendIdMaps(adapter: CDPSessionAdapter): Promise<BackendIdMaps> {
  const domAgent = adapter.domAgent();

  try {
    const response = await domAgent.invoke<{root: any}>('getDocument', {
      depth: -1,
      pierce: true,
    });
    const root = response.root;

    const tagNameMap: Record<number, string> = {};
    const xpathMap: Record<number, string> = {};

    const walkNode = (node: any, path: string): void => {
      if (node.backendNodeId) {
        const tag = String(node.nodeName).toLowerCase();
        tagNameMap[node.backendNodeId] = tag;
        xpathMap[node.backendNodeId] = path;
      }

      // Walk shadow roots first (CDP includes these when pierce: true)
      // Shadow root children share XPath context with the host element
      if (node.shadowRoots?.length) {
        for (const shadowRoot of node.shadowRoots) {
          // Shadow root contents use the same path as the host element
          // since XPath doesn't have native shadow DOM support
          walkNode(shadowRoot, path);
        }
      }

      if (!node.children?.length) {
        return;
      }

      const counters: Record<string, number> = {};

      for (const child of node.children) {
        const name = String(child.nodeName).toLowerCase();
        const counterKey = `${child.nodeType}:${name}`;
        const idx = (counters[counterKey] = (counters[counterKey] ?? 0) + 1);

        let seg: string;
        if (child.nodeType === 3) {
          seg = `text()[${idx}]`;
        } else if (child.nodeType === 8) {
          seg = `comment()[${idx}]`;
        } else {
          seg = `${name}[${idx}]`;
        }

        walkNode(child, `${path}/${seg}`);
      }
    };

    walkNode(root, '');

    logger.info(
        `Built backend ID maps: ${Object.keys(tagNameMap).length} tag mappings, ${Object.keys(xpathMap).length} xpath mappings`);

    return {tagNameMap, xpathMap};
  } catch (error) {
    logger.error('Error building backend ID maps:', error);
    return {tagNameMap: {}, xpathMap: {}};
  }
}

// ============================================================================
// XPath Resolution
// ============================================================================

/**
 * Gets XPath by resolved object ID
 */
export async function getXPathByResolvedObjectId(
    adapter: CDPSessionAdapter,
    resolvedObjectId: string,
): Promise<string> {
  const runtimeAgent = adapter.runtimeAgent();
  const response = await runtimeAgent.invoke<{result?: {value?: string}}>('callFunctionOn', {
    objectId: resolvedObjectId,
    functionDeclaration: `function() {
      ${XPATH_BUILDER_FUNCTION_STRING}
      return getNodePath(this);
    }`,
    returnByValue: true,
  });

  return response.result?.value || '';
}

/**
 * Resolves a DOM BackendNodeId to an XPath string
 */
export async function getXPathByBackendNodeId(
    adapter: CDPSessionAdapter,
    backendNodeId: number,
): Promise<string> {
  try {
    const domAgent = adapter.domAgent();
    const response = await domAgent.invoke<{object?: {objectId?: string}}>('resolveNode', {
      backendNodeId,
    });

    if (!response.object || !response.object.objectId) {
      return '';
    }

    return await getXPathByResolvedObjectId(adapter, response.object.objectId);
  } catch (error) {
    logger.error('Error resolving BackendNodeId to XPath:', error);
    return '';
  }
}

// ============================================================================
// Scrollable Elements
// ============================================================================

const getScrollableElementXpathsFunction = `
window.getScrollableElementXpaths = function() {
  ${XPATH_BUILDER_FUNCTION_STRING}

  const allElements = document.querySelectorAll('*');
  const scrollableElements = [];

  for (const el of allElements) {
    const style = window.getComputedStyle(el);
    const hasScrollableOverflow =
      style.overflowX === 'scroll' || style.overflowX === 'auto' ||
      style.overflowY === 'scroll' || style.overflowY === 'auto';

    if (hasScrollableOverflow && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) {
      scrollableElements.push(getNodePath(el));
    }
  }

  // Also check the document body and html
  if (document.body.scrollHeight > document.body.clientHeight ||
      document.body.scrollWidth > document.body.clientWidth) {
    scrollableElements.push('/html/body');
  }

  return scrollableElements;
}`;

/**
 * Initialize the getScrollableElementXpaths function in the browser
 */
async function initializeScrollableElementsFunction(adapter: CDPSessionAdapter): Promise<void> {
  const runtimeAgent = adapter.runtimeAgent();
  await runtimeAgent.invoke('evaluate', {
    expression: getScrollableElementXpathsFunction,
    returnByValue: true,
  });
}

/**
 * Finds all scrollable elements in the DOM and returns their backendNodeIds.
 */
export async function findScrollableElementIds(adapter: CDPSessionAdapter): Promise<Set<number>> {
  await initializeScrollableElementsFunction(adapter);

  const runtimeAgent = adapter.runtimeAgent();
  const evaluateResult = await runtimeAgent.invoke<{result?: {value?: string[]}}>('evaluate', {
    expression: 'window.getScrollableElementXpaths()',
    returnByValue: true,
  });

  const xpaths = evaluateResult.result?.value || [];
  const scrollableBackendIds = new Set<number>();

  try {
    const domAgent = adapter.domAgent();

    for (const xpath of xpaths) {
      if (!xpath) {
        continue;
      }

      const evaluateResponse = await runtimeAgent.invoke<{result?: {objectId?: string}}>('evaluate', {
        expression: `
          (function() {
            const res = document.evaluate(${JSON.stringify(xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            return res.singleNodeValue;
          })();
        `,
        returnByValue: false,
      });

      const result = evaluateResponse.result;

      if (result?.objectId) {
        const nodeResponse = await domAgent.invoke<{node?: {backendNodeId?: number}}>('describeNode', {
          objectId: result.objectId,
        });

        const node = nodeResponse.node;
        if (node?.backendNodeId) {
          scrollableBackendIds.add(node.backendNodeId);
        }
      }
    }
  } catch (error) {
    logger.error('Error finding scrollable element IDs:', error);
  }

  return scrollableBackendIds;
}

// ============================================================================
// Accessibility Tree
// ============================================================================

/**
 * Builds a hierarchical accessibility tree from flat CDP nodes
 */
async function buildHierarchicalTree(
    accessibilityNodes: AccessibilityNode[],
    adapter?: CDPSessionAdapter,
    scrollableBackendIds?: Set<number>,
): Promise<TreeResult> {
  // Build tagNameMap if adapter is provided
  let tagNameMap: Record<number, string> = {};
  let xpathMap: Record<number, string> = {};

  if (adapter) {
    const maps = await buildBackendIdMaps(adapter);
    tagNameMap = maps.tagNameMap;
    xpathMap = maps.xpathMap;
  }

  // Build node map for parent-child lookup
  const nodeMap = new Map<string, AccessibilityNode>();
  for (const node of accessibilityNodes) {
    if (node.nodeId) {
      nodeMap.set(node.nodeId, node);
    }
  }

  // Find root nodes (nodes without parents or with non-existent parents)
  const rootNodes: AccessibilityNode[] = [];
  for (const node of accessibilityNodes) {
    if (!node.parentId || !nodeMap.has(node.parentId)) {
      rootNodes.push(node);
    }
  }

  // Build tree recursively
  const buildTree = (node: AccessibilityNode): AccessibilityNode => {
    const children: AccessibilityNode[] = [];

    if (node.childIds) {
      for (const childId of node.childIds) {
        const childNode = nodeMap.get(childId);
        if (childNode) {
          children.push(buildTree(childNode));
        }
      }
    }

    return {
      ...node,
      children: children.length > 0 ? children : undefined,
      childIds: undefined,
      parentId: undefined,
    };
  };

  const tree = rootNodes.map(buildTree);

  // Build simplified string representation
  const simplified = tree.map(node => formatSimplifiedTree(node)).join('');

  // Build scrollable container nodes list
  const scrollableContainerNodes: Array<{
    nodeId: string,
    role: string,
    backendDOMNodeId?: number,
    name?: string,
  }> = [];

  if (scrollableBackendIds) {
    for (const node of accessibilityNodes) {
      if (node.nodeId && node.backendDOMNodeId && scrollableBackendIds.has(node.backendDOMNodeId)) {
        scrollableContainerNodes.push({
          nodeId: node.nodeId,
          role: node.role,
          backendDOMNodeId: node.backendDOMNodeId,
          name: node.name,
        });
      }
    }
  }

  // Build nodeId → backendDOMNodeId mapping for ID translation
  const nodeIdToBackendId: Record<string, number> = {};
  for (const node of accessibilityNodes) {
    if (node.nodeId && node.backendDOMNodeId) {
      nodeIdToBackendId[node.nodeId] = node.backendDOMNodeId;
    }
  }

  return {
    tree,
    simplified,
    iframes: [],
    scrollableContainerNodes,
    xpathMap,
    tagNameMap,
    nodeIdToBackendId,
  };
}

/**
 * Transform CDP accessibility node to internal format with EncodedId.
 * @param node Raw CDP accessibility node
 * @param frameOrdinal Frame ordinal for EncodedId generation (0 for main frame)
 * @param axNodeIdToEncodedId Map to track accessibility nodeId → EncodedId for parent/child resolution
 */
function transformCdpNode(
    node: any,
    frameOrdinal: number,
    axNodeIdToEncodedId: Map<string, string>,
): AccessibilityNode | null {
  const roleValue = node.role && typeof node.role === 'object' && 'value' in node.role
                        ? node.role.value
                        : '';

  const nameValue = node.name && typeof node.name === 'object' && 'value' in node.name
                        ? node.name.value
                        : undefined;

  const descriptionValue =
      node.description && typeof node.description === 'object' && 'value' in node.description
          ? node.description.value
          : undefined;

  const valueValue = node.value && typeof node.value === 'object' && 'value' in node.value
                         ? node.value.value
                         : undefined;

  const backendNodeId =
      typeof node.backendDOMNodeId === 'number' ? node.backendDOMNodeId : undefined;

  // Skip nodes without backendDOMNodeId as they can't be targeted
  if (backendNodeId === undefined) {
    return null;
  }

  // Create EncodedId for this node
  const encodedId = makeEncodedId(frameOrdinal, backendNodeId);

  // Store mapping from accessibility nodeId to EncodedId for parent/child resolution
  if (node.nodeId) {
    axNodeIdToEncodedId.set(`${frameOrdinal}:${node.nodeId}`, encodedId);
  }

  return {
    role: roleValue,
    name: nameValue,
    description: descriptionValue,
    value: valueValue,
    nodeId: encodedId,  // Use EncodedId instead of accessibility nodeId
    backendDOMNodeId: backendNodeId,
    parentId: node.parentId ? `${frameOrdinal}:${node.parentId}` : undefined,
    childIds: node.childIds?.map((id: string) => `${frameOrdinal}:${id}`),
    properties: node.properties,
  };
}

/**
 * Retrieves the full accessibility tree via CDP and transforms it into a hierarchical structure.
 * Supports iframe content by fetching accessibility trees from all frames.
 */
export async function getAccessibilityTree(adapter: CDPSessionAdapter): Promise<TreeResult> {
  try {
    const startTime = Date.now();
    const scrollableBackendIds = await findScrollableElementIds(adapter);
    const accessibilityAgent = adapter.accessibilityAgent();

    // Collect all frames using FrameRegistryUniversal
    const frameRegistry = new FrameRegistryUniversal(adapter);
    const frames = await frameRegistry.collectFrames();

    if (frames.length === 0) {
      logger.warn('No frames found, falling back to main frame only');
      // Fallback: fetch main frame only
      const response = await accessibilityAgent.invoke<{nodes: any[]}>('getFullAXTree', {});
      const axNodeIdToEncodedId = new Map<string, string>();
      const accessibilityNodes = response.nodes
          .map((node: any) => transformCdpNode(node, 0, axNodeIdToEncodedId))
          .filter((n): n is AccessibilityNode => n !== null);

      const hierarchicalTree = await buildHierarchicalTreeWithEncodedIds(
          accessibilityNodes, axNodeIdToEncodedId, adapter, scrollableBackendIds);
      logger.info(`got accessibility tree (main frame only) in ${Date.now() - startTime}ms`);
      return hierarchicalTree;
    }

    // Fetch accessibility trees for all frames in parallel
    const allAccessibilityNodes: AccessibilityNode[] = [];
    const axNodeIdToEncodedId = new Map<string, string>();
    const frameIds: string[] = [];

    const framePromises = frames.map(async (frame) => {
      try {
        const response = await accessibilityAgent.invoke<{nodes: any[]}>('getFullAXTree', {
          frameId: frame.frameId,
        });

        const nodes = response.nodes
            .map((node: any) => transformCdpNode(node, frame.ordinal, axNodeIdToEncodedId))
            .filter((n): n is AccessibilityNode => n !== null);

        return { frameOrdinal: frame.ordinal, frameId: frame.frameId, nodes };
      } catch (error) {
        // Frame may be cross-origin or detached - skip silently
        logger.debug(`Failed to fetch accessibility tree for frame ${frame.frameId}:`, error);
        return null;
      }
    });

    const frameResults = await Promise.all(framePromises);

    // Merge nodes from all frames
    for (const result of frameResults) {
      if (result) {
        allAccessibilityNodes.push(...result.nodes);
        if (result.frameOrdinal > 0) {
          frameIds.push(result.frameId);
        }
      }
    }

    const hierarchicalTree = await buildHierarchicalTreeWithEncodedIds(
        allAccessibilityNodes, axNodeIdToEncodedId, adapter, scrollableBackendIds, frameIds);

    logger.info(`got accessibility tree (${frames.length} frames) in ${Date.now() - startTime}ms`);
    return hierarchicalTree;
  } catch (error) {
    logger.error('Error getting accessibility tree', error);
    throw error;
  }
}

/**
 * Builds a hierarchical accessibility tree from flat nodes with EncodedId support.
 * This is an adapted version of buildHierarchicalTree that handles EncodedId parent/child references.
 */
async function buildHierarchicalTreeWithEncodedIds(
    accessibilityNodes: AccessibilityNode[],
    axNodeIdToEncodedId: Map<string, string>,
    adapter?: CDPSessionAdapter,
    scrollableBackendIds?: Set<number>,
    frameIds?: string[],
): Promise<TreeResult> {
  // Build tagNameMap if adapter is provided
  let tagNameMap: Record<number, string> = {};
  let xpathMap: Record<number, string> = {};

  if (adapter) {
    const maps = await buildBackendIdMaps(adapter);
    tagNameMap = maps.tagNameMap;
    xpathMap = maps.xpathMap;
  }

  // Build node map using EncodedId as key
  const nodeMap = new Map<string, AccessibilityNode>();
  for (const node of accessibilityNodes) {
    if (node.nodeId) {
      nodeMap.set(node.nodeId, node);
    }
  }

  // Resolve parent/child references to EncodedIds
  for (const node of accessibilityNodes) {
    // Convert parentId from "frameOrdinal:axNodeId" to EncodedId
    if (node.parentId && typeof node.parentId === 'string') {
      const encodedParent = axNodeIdToEncodedId.get(node.parentId);
      node.parentId = encodedParent;
    }

    // Convert childIds from "frameOrdinal:axNodeId" to EncodedIds
    if (node.childIds) {
      node.childIds = node.childIds
          .map((id: string) => axNodeIdToEncodedId.get(id))
          .filter((id): id is string => id !== undefined);
    }
  }

  // Find root nodes (nodes without parents or with non-existent parents)
  const rootNodes: AccessibilityNode[] = [];
  for (const node of accessibilityNodes) {
    if (!node.parentId || !nodeMap.has(node.parentId)) {
      rootNodes.push(node);
    }
  }

  // Build tree recursively
  const buildTree = (node: AccessibilityNode): AccessibilityNode => {
    const children: AccessibilityNode[] = [];

    if (node.childIds) {
      for (const childId of node.childIds) {
        const childNode = nodeMap.get(childId);
        if (childNode) {
          children.push(buildTree(childNode));
        }
      }
    }

    return {
      ...node,
      children: children.length > 0 ? children : undefined,
      childIds: undefined,
      parentId: undefined,
    };
  };

  const tree = rootNodes.map(buildTree);

  // Build simplified string representation (now uses EncodedId in node.nodeId)
  const simplified = tree.map(node => formatSimplifiedTree(node)).join('');

  // Build scrollable container nodes list
  const scrollableContainerNodes: Array<{
    nodeId: string,
    role: string,
    backendDOMNodeId?: number,
    name?: string,
  }> = [];

  if (scrollableBackendIds) {
    for (const node of accessibilityNodes) {
      if (node.nodeId && node.backendDOMNodeId && scrollableBackendIds.has(node.backendDOMNodeId)) {
        scrollableContainerNodes.push({
          nodeId: node.nodeId,
          role: node.role,
          backendDOMNodeId: node.backendDOMNodeId,
          name: node.name,
        });
      }
    }
  }

  // Build EncodedId → backendDOMNodeId mapping (for backward compatibility)
  const nodeIdToBackendId: Record<string, number> = {};
  for (const node of accessibilityNodes) {
    if (node.nodeId && node.backendDOMNodeId) {
      nodeIdToBackendId[node.nodeId] = node.backendDOMNodeId;
    }
  }

  // Note: iframe content is now included in the main tree (distinguished by EncodedId frame ordinal)
  // The iframes array is kept empty for backward compatibility - use frameOrdinal > 0 in EncodedId to identify iframe elements
  return {
    tree,
    simplified,
    iframes: [],
    scrollableContainerNodes,
    xpathMap,
    tagNameMap,
    nodeIdToBackendId,
  };
}

// ============================================================================
// Perform Action
// ============================================================================

/**
 * Performs an action on a DOM element identified by XPath
 */
export async function performAction(
    adapter: CDPSessionAdapter,
    method: string,
    args: unknown[],
    xpath: string,
    iframeNodeId?: string,
): Promise<void> {
  const runtimeAgent = adapter.runtimeAgent();
  const domAgent = adapter.domAgent();
  const inputAgent = adapter.inputAgent();
  const accessibilityAgent = adapter.accessibilityAgent();

  let objectId: string;

  // Handle iframe-specific elements
  if (iframeNodeId) {
    logger.info(`Performing action in iframe ${iframeNodeId} for element ${xpath}`);

    const response = await accessibilityAgent.invoke<{nodes: any[]}>('getFullAXTree', {});
    const nodes = response.nodes;

    const iframeNode = nodes.find((node: any) => node.nodeId === iframeNodeId);
    if (!iframeNode || !iframeNode.backendDOMNodeId) {
      throw new Error(`Could not find iframe with nodeId ${iframeNodeId}`);
    }

    const resolveResponse =
        await domAgent.invoke<{object?: {objectId?: string}}>('resolveNode', {
          backendNodeId: iframeNode.backendDOMNodeId,
        });

    if (!resolveResponse.object?.objectId) {
      throw new Error(`Could not resolve iframe node ${iframeNodeId}`);
    }

    const elementNodeId = xpath;

    const domNodeResponse = await domAgent.invoke<{node?: {frameId?: string}}>('describeNode', {
      backendNodeId: iframeNode.backendDOMNodeId,
    });

    if (!domNodeResponse.node?.frameId) {
      throw new Error(`Could not get frameId for iframe ${iframeNodeId}`);
    }

    const iframeAccessibilityResponse = await accessibilityAgent.invoke<{nodes: any[]}>('getFullAXTree', {
      frameId: domNodeResponse.node.frameId,
    });

    const elementNode =
        iframeAccessibilityResponse.nodes.find((node: any) => node.nodeId === elementNodeId);
    if (!elementNode || !elementNode.backendDOMNodeId) {
      throw new Error(
          `Could not find element with nodeId ${elementNodeId} in iframe ${iframeNodeId}`);
    }

    const elementResolveResponse =
        await domAgent.invoke<{object?: {objectId?: string}}>('resolveNode', {
          backendNodeId: elementNode.backendDOMNodeId,
        });

    if (!elementResolveResponse.object?.objectId) {
      throw new Error(`Could not resolve element node ${elementNodeId} in iframe ${iframeNodeId}`);
    }

    objectId = elementResolveResponse.object.objectId;
  } else {
    // Locate element by XPath using composed tree resolver (supports shadow DOM)
    // First tries __browserOperator__.resolveSimpleXPath (pierces shadow DOM)
    // Falls back to standard document.evaluate for regular XPath
    const evaluateResult = await runtimeAgent.invoke<{result?: {objectId?: string}}>('evaluate', {
      expression: `
        (function() {
          const xp = ${JSON.stringify(xpath)};
          try {
            // Try composed tree resolver first (handles shadow DOM)
            if (window.__browserOperator__?.resolveSimpleXPath) {
              const el = window.__browserOperator__.resolveSimpleXPath(xp);
              if (el) return el;
            }
          } catch (e) {
            console.warn('[utils-universal] Shadow DOM resolver failed for xpath:', xp, e);
          }
          try {
            // Fall back to standard XPath evaluation
            const res = document.evaluate(
              xp.replace(/^xpath=/i, ''),
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            );
            return res.singleNodeValue;
          } catch (e) {
            console.warn('[utils-universal] Standard XPath evaluation failed for xpath:', xp, e);
            return null;
          }
        })()
      `,
      returnByValue: false,
    });

    if (!evaluateResult.result?.objectId) {
      throw new Error(`Could not find element with xpath ${xpath} in main document`);
    }

    objectId = evaluateResult.result.objectId;
  }

  try {
    if (method === 'click') {
      try {
        await runtimeAgent.invoke('callFunctionOn', {
          objectId,
          functionDeclaration: `
            function() {
              if ('scrollIntoView' in this) {
                this.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }

              return new Promise(resolve => {
                const initialRect = this.getBoundingClientRect();
                let lastTop = initialRect.top;
                let lastLeft = initialRect.left;
                let positionStableCount = 0;
                const maxWaitTime = 1000;
                const startTime = Date.now();

                const checkPosition = () => {
                  const currentRect = this.getBoundingClientRect();
                  const currentTop = currentRect.top;
                  const currentLeft = currentRect.left;

                  if (Math.abs(currentTop - lastTop) < 1 && Math.abs(currentLeft - lastLeft) < 1) {
                    positionStableCount++;

                    if (positionStableCount >= 3 || (Date.now() - startTime > maxWaitTime)) {
                      this.click();
                      resolve(true);
                      return;
                    }
                  } else {
                    positionStableCount = 0;
                  }

                  lastTop = currentTop;
                  lastLeft = currentLeft;
                  setTimeout(checkPosition, 50);
                };

                setTimeout(checkPosition, 50);
              });
            }
          `,
          returnByValue: true,
          awaitPromise: true,
        });
      } catch (e) {
        logger.warn(`Direct click failed, falling back to mouse events: ${e}`);
        await clickWithMouseEvents(domAgent, inputAgent, objectId);
      }
    } else if (method === 'rightClick') {
      await rightClickElement(domAgent, inputAgent, objectId);
    } else if (method === 'hover') {
      await hoverElement(domAgent, inputAgent, objectId);
    } else if (method === 'drag') {
      await dragElement(domAgent, inputAgent, objectId, args);
    } else if (method === 'fill' || method === 'type') {
      await fillElement(runtimeAgent, inputAgent, objectId, args);
    } else if (method === 'press') {
      await pressKey(inputAgent, args);
    } else if (method === 'focus') {
      await focusElement(runtimeAgent, objectId);
    } else if (method === 'scrollIntoView') {
      await scrollElementIntoView(runtimeAgent, objectId);
    } else if (method === 'selectOption') {
      await selectOption(runtimeAgent, objectId, args);
    } else if (method === 'check') {
      await checkElement(runtimeAgent, objectId);
    } else if (method === 'uncheck') {
      await uncheckElement(runtimeAgent, objectId);
    } else if (method === 'setChecked') {
      await setCheckedState(runtimeAgent, objectId, args);
    } else {
      throw new Error(`Method ${method} not supported`);
    }
  } catch (error) {
    throw error;
  }
}

// ============================================================================
// Perform Action by BackendNodeId (cross-frame compatible)
// ============================================================================

/**
 * Gets the execution context ID for a specific frame.
 * This is needed to resolve nodes in iframes via DOM.resolveNode.
 */
async function getFrameExecutionContextId(
    adapter: CDPSessionAdapter,
    frameId: string,
): Promise<number | undefined> {
  try {
    const pageAgent = adapter.pageAgent();

    // Create an isolated world in the frame to get its execution context
    // Note: createIsolatedWorld is a Page domain method, not Runtime
    const response = await pageAgent.invoke<{executionContextId: number}>('createIsolatedWorld', {
      frameId,
      worldName: 'frame-context-resolver',
    });

    return response.executionContextId;
  } catch (error) {
    logger.warn(`Failed to get execution context for frame ${frameId}:`, error);
    return undefined;
  }
}

/**
 * Performs an action on a DOM element identified by backendNodeId.
 * This works across frames since backendNodeIds are unique within a target.
 *
 * @param adapter - CDP session adapter
 * @param method - Action method to perform
 * @param args - Arguments for the action
 * @param backendNodeId - Backend node ID of the element
 * @param frameOrdinal - Optional frame ordinal for cross-frame resolution (0 = main frame)
 */
export async function performActionByBackendNodeId(
    adapter: CDPSessionAdapter,
    method: string,
    args: unknown[],
    backendNodeId: number,
    frameOrdinal?: number,
): Promise<{verification?: ElementStateVerification}> {
  const runtimeAgent = adapter.runtimeAgent();
  const domAgent = adapter.domAgent();
  const inputAgent = adapter.inputAgent();

  logger.info(`[performActionByBackendNodeId] method=${method}, backendNodeId=${backendNodeId}, frameOrdinal=${frameOrdinal}`);

  // Resolve backendNodeId to objectId for methods that need JavaScript execution
  let objectId: string | undefined;
  let executionContextId: number | undefined;

  // Methods that benefit from JavaScript execution (trusted events) rather than CDP Input events
  // Click is included because JS element.click() creates trusted events that bypass bot detection
  if (['click', 'fill', 'type', 'selectOption', 'check', 'uncheck', 'setChecked', 'focus', 'setValue'].includes(method)) {
    // For iframe nodes (frameOrdinal > 0), we need to resolve with frame context
    if (frameOrdinal !== undefined && frameOrdinal > 0) {
      const frameRegistry = new FrameRegistryUniversal(adapter);
      await frameRegistry.collectFrames();
      const frameInfo = frameRegistry.getFrameByOrdinal(frameOrdinal);

      if (frameInfo) {
        logger.info(`[performActionByBackendNodeId] Resolving in iframe: frameId=${frameInfo.frameId}`);
        executionContextId = await getFrameExecutionContextId(adapter, frameInfo.frameId);

        if (executionContextId) {
          const resolveResponse = await domAgent.invoke<{object?: {objectId?: string}}>('resolveNode', {
            backendNodeId,
            executionContextId,
          });

          if (resolveResponse.object?.objectId) {
            objectId = resolveResponse.object.objectId;
            logger.info(`[performActionByBackendNodeId] Resolved iframe node to objectId=${objectId}`);
          }
        }
      }

      if (!objectId) {
        throw new Error(`Could not resolve iframe backendNodeId ${backendNodeId} (frame ${frameOrdinal}) to objectId`);
      }
    } else {
      // Main frame resolution (original behavior)
      const resolveResponse = await domAgent.invoke<{object?: {objectId?: string}}>('resolveNode', {
        backendNodeId,
      });

      if (!resolveResponse.object?.objectId) {
        throw new Error(`Could not resolve backendNodeId ${backendNodeId} to objectId`);
      }
      objectId = resolveResponse.object.objectId;
      logger.info(`[performActionByBackendNodeId] Resolved to objectId=${objectId}`);
    }
  }

  // Perform the action
  if (method === 'click') {
    if (objectId) {
      // Use JS click for trusted events (same approach as performAction)
      // This bypasses bot detection on e-commerce sites that check event.isTrusted
      try {
        await clickElementWithJS(runtimeAgent, objectId, executionContextId);
        logger.info(`[performActionByBackendNodeId] JS click succeeded for backendNodeId=${backendNodeId}`);
      } catch (e) {
        logger.warn(`[performActionByBackendNodeId] JS click failed, falling back to CDP input events: ${e}`);
        await clickByBackendNodeId(domAgent, inputAgent, backendNodeId);
      }
    } else {
      // Fallback to CDP input events if objectId resolution failed
      logger.info(`[performActionByBackendNodeId] No objectId, using CDP input events for backendNodeId=${backendNodeId}`);
      await clickByBackendNodeId(domAgent, inputAgent, backendNodeId);
    }
  } else if (method === 'rightClick') {
    await rightClickByBackendNodeId(domAgent, inputAgent, backendNodeId);
  } else if (method === 'hover') {
    await hoverByBackendNodeId(domAgent, inputAgent, backendNodeId);
  } else if (method === 'scrollIntoView') {
    await scrollIntoViewByBackendNodeId(domAgent, backendNodeId);
  } else if ((method === 'fill' || method === 'type') && objectId) {
    await fillElement(runtimeAgent, inputAgent, objectId, args, executionContextId);
  } else if (method === 'press') {
    await pressKey(inputAgent, args);
  } else if (method === 'focus' && objectId) {
    await focusElement(runtimeAgent, objectId);
  } else if (method === 'selectOption' && objectId) {
    await selectOption(runtimeAgent, objectId, args, executionContextId);
  } else if ((method === 'check' || method === 'uncheck' || method === 'setChecked') && objectId) {
    await setCheckedState(runtimeAgent, objectId, args, executionContextId);
  } else if (method === 'setValue' && objectId) {
    const result = await setValueElement(runtimeAgent, objectId, args, executionContextId);
    if (!result.success) {
      throw new Error(result.message);
    }
    logger.info(`[performActionByBackendNodeId] setValue: ${result.message}`);
  } else if (method === 'drag') {
    await dragByBackendNodeId(domAgent, inputAgent, backendNodeId, args);
  } else {
    throw new Error(`Method ${method} not supported for backendNodeId-based action`);
  }

  // Verify state for state-changing actions
  const stateChangingActions = ['check', 'uncheck', 'setChecked', 'fill', 'type', 'selectOption', 'click', 'setValue'];
  if (stateChangingActions.includes(method)) {
    const verification = await verifyElementState(adapter, backendNodeId, method, args);
    return {verification};
  }

  return {};
}

/**
 * Click element by backendNodeId using Input events.
 */
async function clickByBackendNodeId(
    domAgent: ReturnType<CDPSessionAdapter['domAgent']>,
    inputAgent: ReturnType<CDPSessionAdapter['inputAgent']>,
    backendNodeId: number,
): Promise<void> {
  await scrollIntoViewByBackendNodeId(domAgent, backendNodeId);
  const {x, y} = await getElementCenterFromBackendNodeId(domAgent, backendNodeId);
  logger.info(`[clickByBackendNodeId] Clicking at (${x}, ${y})`);
  await dispatchClick(inputAgent, x, y, 'left');
}

/**
 * Right-click element by backendNodeId using Input events.
 */
async function rightClickByBackendNodeId(
    domAgent: ReturnType<CDPSessionAdapter['domAgent']>,
    inputAgent: ReturnType<CDPSessionAdapter['inputAgent']>,
    backendNodeId: number,
): Promise<void> {
  await scrollIntoViewByBackendNodeId(domAgent, backendNodeId);
  const {x, y} = await getElementCenterFromBackendNodeId(domAgent, backendNodeId);
  logger.info(`[rightClickByBackendNodeId] Right-clicking at (${x}, ${y})`);
  await dispatchClick(inputAgent, x, y, 'right');
}

/**
 * Hover element by backendNodeId using Input events.
 */
async function hoverByBackendNodeId(
    domAgent: ReturnType<CDPSessionAdapter['domAgent']>,
    inputAgent: ReturnType<CDPSessionAdapter['inputAgent']>,
    backendNodeId: number,
): Promise<void> {
  const {x, y} = await getElementCenterFromBackendNodeId(domAgent, backendNodeId);
  await dispatchMouseMove(inputAgent, x, y);
}

/**
 * Scroll element into view by backendNodeId.
 */
async function scrollIntoViewByBackendNodeId(
    domAgent: ReturnType<CDPSessionAdapter['domAgent']>,
    backendNodeId: number,
): Promise<void> {
  await domAgent.invoke('scrollIntoViewIfNeeded', {
    backendNodeId,
  });
}

/**
 * Drag element by backendNodeId using Input events.
 * Supports both relative offset (offsetX, offsetY) and absolute position (toX, toY).
 */
async function dragByBackendNodeId(
    domAgent: ReturnType<CDPSessionAdapter['domAgent']>,
    inputAgent: ReturnType<CDPSessionAdapter['inputAgent']>,
    backendNodeId: number,
    args: unknown[],
): Promise<void> {
  await scrollIntoViewByBackendNodeId(domAgent, backendNodeId);
  const {x: startX, y: startY} = await getElementCenterFromBackendNodeId(domAgent, backendNodeId);

  const dragArgs = args[0] as {offsetX?: number; offsetY?: number; toX?: number; toY?: number} | undefined;
  let endX: number;
  let endY: number;

  if (dragArgs?.toX !== undefined && dragArgs?.toY !== undefined) {
    endX = dragArgs.toX;
    endY = dragArgs.toY;
  } else {
    endX = startX + (dragArgs?.offsetX || 0);
    endY = startY + (dragArgs?.offsetY || 0);
  }

  logger.info(`[dragByBackendNodeId] Dragging from (${startX}, ${startY}) to (${endX}, ${endY})`);
  await dispatchDrag(inputAgent, startX, startY, endX, endY);
}

// Helper functions for performAction
async function clickWithMouseEvents(
    domAgent: ReturnType<CDPSessionAdapter['domAgent']>,
    inputAgent: ReturnType<CDPSessionAdapter['inputAgent']>,
    objectId: string,
): Promise<void> {
  const {x, y} = await getElementCenterFromObjectId(domAgent, objectId);
  await dispatchClick(inputAgent, x, y, 'left');
}

/**
 * Click element using JavaScript for trusted events.
 * This creates events with isTrusted=true that bypass bot detection on e-commerce sites.
 * Scrolls element into view, waits for position to stabilize, then clicks.
 */
async function clickElementWithJS(
    runtimeAgent: ReturnType<CDPSessionAdapter['runtimeAgent']>,
    objectId: string,
    executionContextId?: number,
): Promise<void> {
  await runtimeAgent.invoke('callFunctionOn', {
    objectId,
    executionContextId,
    functionDeclaration: `
      function() {
        if ('scrollIntoView' in this) {
          this.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        return new Promise(resolve => {
          const initialRect = this.getBoundingClientRect();
          let lastTop = initialRect.top;
          let lastLeft = initialRect.left;
          let positionStableCount = 0;
          const maxWaitTime = 1000;
          const startTime = Date.now();

          const checkPosition = () => {
            const currentRect = this.getBoundingClientRect();
            const currentTop = currentRect.top;
            const currentLeft = currentRect.left;

            if (Math.abs(currentTop - lastTop) < 1 && Math.abs(currentLeft - lastLeft) < 1) {
              positionStableCount++;

              if (positionStableCount >= 3 || (Date.now() - startTime > maxWaitTime)) {
                this.click();
                resolve(true);
                return;
              }
            } else {
              positionStableCount = 0;
            }

            lastTop = currentTop;
            lastLeft = currentLeft;
            setTimeout(checkPosition, 50);
          };

          setTimeout(checkPosition, 50);
        });
      }
    `,
    returnByValue: true,
    awaitPromise: true,
  });
}

async function rightClickElement(
    domAgent: ReturnType<CDPSessionAdapter['domAgent']>,
    inputAgent: ReturnType<CDPSessionAdapter['inputAgent']>,
    objectId: string,
): Promise<void> {
  const {x, y} = await getElementCenterFromObjectId(domAgent, objectId);
  logger.info(`[rightClickElement] Right-clicking at (${x}, ${y})`);
  await dispatchClick(inputAgent, x, y, 'right');
}

async function hoverElement(
    domAgent: ReturnType<CDPSessionAdapter['domAgent']>,
    inputAgent: ReturnType<CDPSessionAdapter['inputAgent']>,
    objectId: string,
): Promise<void> {
  const {x, y} = await getElementCenterFromObjectId(domAgent, objectId);
  await dispatchMouseMove(inputAgent, x, y);
}

async function dragElement(
    domAgent: ReturnType<CDPSessionAdapter['domAgent']>,
    inputAgent: ReturnType<CDPSessionAdapter['inputAgent']>,
    objectId: string,
    args: unknown[],
): Promise<void> {
  const {x: startX, y: startY} = await getElementCenterFromObjectId(domAgent, objectId);

  const dragArgs = args[0] as {offsetX?: number; offsetY?: number; toX?: number; toY?: number};
  let endX: number;
  let endY: number;

  if (dragArgs.toX !== undefined && dragArgs.toY !== undefined) {
    endX = dragArgs.toX;
    endY = dragArgs.toY;
  } else {
    endX = startX + (dragArgs.offsetX || 0);
    endY = startY + (dragArgs.offsetY || 0);
  }

  await dispatchDrag(inputAgent, startX, startY, endX, endY);
}

async function fillElement(
    runtimeAgent: ReturnType<CDPSessionAdapter['runtimeAgent']>,
    inputAgent: ReturnType<CDPSessionAdapter['inputAgent']>,
    objectId: string,
    args: unknown[],
    executionContextId?: number,
): Promise<void> {
  const text = String(args[0] || '');

  await runtimeAgent.invoke('callFunctionOn', {
    objectId,
    functionDeclaration: `
      function() {
        this.focus();
        if (this.value !== undefined) {
          this.value = "";
        }
        return true;
      }
    `,
    returnByValue: true,
  });

  for (const char of text) {
    await inputAgent.invoke('dispatchKeyEvent', {
      type: 'keyDown',
      text: char,
    });

    await inputAgent.invoke('dispatchKeyEvent', {
      type: 'keyUp',
    });
  }

  await runtimeAgent.invoke('callFunctionOn', {
    objectId,
    functionDeclaration: `
      function(value) {
        if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
          this.value = value;
          this.dispatchEvent(new Event('input', { bubbles: true }));
          this.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      }
    `,
    arguments: [{value: text}],
    returnByValue: true,
  });
}

async function pressKey(
    inputAgent: ReturnType<CDPSessionAdapter['inputAgent']>,
    args: unknown[],
): Promise<void> {
  const key = String(args[0] || '');

  await inputAgent.invoke('dispatchKeyEvent', {
    type: 'keyDown',
    key,
  });

  await inputAgent.invoke('dispatchKeyEvent', {
    type: 'keyUp',
    key,
  });
}

async function scrollElementIntoView(
    runtimeAgent: ReturnType<CDPSessionAdapter['runtimeAgent']>,
    objectId: string,
): Promise<void> {
  await runtimeAgent.invoke('callFunctionOn', {
    objectId,
    functionDeclaration: `
      function() {
        if ('scrollIntoView' in this) {
          this.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return true;
      }
    `,
    returnByValue: true,
  });
}

async function selectOption(
    runtimeAgent: ReturnType<CDPSessionAdapter['runtimeAgent']>,
    objectId: string,
    args: unknown[],
    executionContextId?: number,
): Promise<void> {
  const optionValue = String(args[0] || '');

  await runtimeAgent.invoke('callFunctionOn', {
    objectId,
    functionDeclaration: `
      function(value) {
        if (this.tagName.toLowerCase() === 'select') {
          let optionFound = false;
          for (let i = 0; i < this.options.length; i++) {
            const option = this.options[i];
            if (option.value === value || option.text === value || option.textContent === value) {
              this.selectedIndex = i;
              optionFound = true;
              break;
            }
          }

          if (!optionFound) {
            for (let i = 0; i < this.options.length; i++) {
              const option = this.options[i];
              if (option.text.toLowerCase().includes(value.toLowerCase()) ||
                  option.textContent.toLowerCase().includes(value.toLowerCase())) {
                this.selectedIndex = i;
                optionFound = true;
                break;
              }
            }
          }

          if (optionFound) {
            this.dispatchEvent(new Event('change', { bubbles: true }));
            this.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }
          return false;
        }
        return false;
      }
    `,
    arguments: [{value: optionValue}],
    returnByValue: true,
  });
}

/**
 * Focus an element
 */
async function focusElement(
    runtimeAgent: ReturnType<CDPSessionAdapter['runtimeAgent']>,
    objectId: string,
): Promise<void> {
  await runtimeAgent.invoke('callFunctionOn', {
    objectId,
    functionDeclaration: `
      function() {
        this.focus();
        return document.activeElement === this;
      }
    `,
    returnByValue: true,
  });
}

async function checkElement(
    runtimeAgent: ReturnType<CDPSessionAdapter['runtimeAgent']>,
    objectId: string,
    executionContextId?: number,
): Promise<void> {
  await runtimeAgent.invoke('callFunctionOn', {
    objectId,
    functionDeclaration: `
      function() {
        if (this.type === 'checkbox' || this.type === 'radio') {
          if (!this.checked) {
            this.checked = true;
            this.dispatchEvent(new Event('change', { bubbles: true }));
            this.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return true;
        }
        return false;
      }
    `,
    returnByValue: true,
  });
}

async function uncheckElement(
    runtimeAgent: ReturnType<CDPSessionAdapter['runtimeAgent']>,
    objectId: string,
    executionContextId?: number,
): Promise<void> {
  await runtimeAgent.invoke('callFunctionOn', {
    objectId,
    functionDeclaration: `
      function() {
        if (this.type === 'checkbox') {
          if (this.checked) {
            this.checked = false;
            this.dispatchEvent(new Event('change', { bubbles: true }));
            this.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return true;
        }
        return false;
      }
    `,
    returnByValue: true,
  });
}

async function setCheckedState(
    runtimeAgent: ReturnType<CDPSessionAdapter['runtimeAgent']>,
    objectId: string,
    args: unknown[],
    executionContextId?: number,
): Promise<void> {
  const shouldCheck = Boolean(args[0]);

  await runtimeAgent.invoke('callFunctionOn', {
    objectId,
    functionDeclaration: `
      function(checked) {
        if (this.type === 'checkbox' || this.type === 'radio') {
          if (this.checked !== checked) {
            this.checked = checked;
            this.dispatchEvent(new Event('change', { bubbles: true }));
            this.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return true;
        }
        return false;
      }
    `,
    arguments: [{value: shouldCheck}],
    returnByValue: true,
  });
}

// ============================================================================
// Element State Verification
// ============================================================================

/**
 * Element state verification result - returned after state-changing actions
 * to confirm the action actually succeeded.
 */
export interface ElementStateVerification {
  verified: boolean;
  actionMethod: string;
  currentState?: {
    checked?: boolean;
    value?: string;
    selectedOption?: string;
    selectedValue?: string;
    elementType?: string;
  };
  stateConfirmed: boolean;
  summary: string;
}

/**
 * Verifies the current state of an element after an action.
 * Used for state-changing actions to confirm the action succeeded.
 */
export async function verifyElementState(
    adapter: CDPSessionAdapter,
    backendNodeId: number,
    actionMethod: string,
    expectedArgs?: unknown[],
): Promise<ElementStateVerification> {
  const domAgent = adapter.domAgent();
  const runtimeAgent = adapter.runtimeAgent();

  try {
    // Resolve to objectId
    const resolveResponse = await domAgent.invoke<{object?: {objectId?: string}}>('resolveNode', {
      backendNodeId,
    });

    if (!resolveResponse.object?.objectId) {
      return {
        verified: false,
        actionMethod,
        stateConfirmed: false,
        summary: 'Could not resolve element for verification',
      };
    }

    const objectId = resolveResponse.object.objectId;

    // Get element state based on action type
    const stateResult = await runtimeAgent.invoke<{result?: {value?: unknown}}>('callFunctionOn', {
      objectId,
      functionDeclaration: `
        function() {
          const el = this;
          const state = {
            elementType: el.type || el.tagName?.toLowerCase() || 'unknown'
          };

          // Checkbox/Radio state
          if (el.type === 'checkbox' || el.type === 'radio') {
            state.checked = el.checked;
          }

          // Input/Textarea value
          if ('value' in el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
            state.value = el.value;
          }

          // Select element
          if (el.tagName === 'SELECT') {
            state.selectedOption = el.options[el.selectedIndex]?.text || '';
            state.selectedValue = el.value;
          }

          return state;
        }
      `,
      returnByValue: true,
    });

    const currentState = stateResult.result?.value as ElementStateVerification['currentState'] || {};

    // Determine if state matches expectation
    let stateConfirmed = false;
    let summary = '';

    switch (actionMethod) {
      case 'check':
        stateConfirmed = currentState.checked === true;
        summary = stateConfirmed
            ? 'Checkbox is now CHECKED (verified)'
            : `Checkbox verification FAILED - checked=${currentState.checked}`;
        break;

      case 'uncheck':
        stateConfirmed = currentState.checked === false;
        summary = stateConfirmed
            ? 'Checkbox is now UNCHECKED (verified)'
            : `Checkbox verification FAILED - checked=${currentState.checked}`;
        break;

      case 'setChecked': {
        const expectedChecked = Boolean(expectedArgs?.[0]);
        stateConfirmed = currentState.checked === expectedChecked;
        summary = stateConfirmed
            ? `Checkbox state is now ${expectedChecked ? 'CHECKED' : 'UNCHECKED'} (verified)`
            : `setChecked verification FAILED - expected=${expectedChecked}, actual=${currentState.checked}`;
        break;
      }

      case 'fill':
      case 'type': {
        const expectedValue = String(expectedArgs?.[0] || '');
        stateConfirmed = currentState.value === expectedValue;
        summary = stateConfirmed
            ? `Input value is "${currentState.value}" (verified)`
            : `Fill verification FAILED - expected="${expectedValue}", actual="${currentState.value}"`;
        break;
      }

      case 'selectOption': {
        const expectedOption = String(expectedArgs?.[0] || '');
        stateConfirmed = currentState.selectedOption === expectedOption ||
                        currentState.selectedValue === expectedOption;
        summary = stateConfirmed
            ? `Selected option is "${currentState.selectedOption}" (verified)`
            : `selectOption verification FAILED - expected="${expectedOption}", actual="${currentState.selectedOption}"`;
        break;
      }

      case 'click':
        // For radio buttons clicked, verify they're now checked
        if (currentState.elementType === 'radio') {
          stateConfirmed = currentState.checked === true;
          summary = stateConfirmed
              ? 'Radio button is now SELECTED (verified)'
              : 'Radio button verification FAILED - not selected after click';
        } else {
          // For other clicks, we can't verify state easily
          stateConfirmed = true;
          summary = 'Click action completed';
        }
        break;

      default:
        summary = `No state verification for action: ${actionMethod}`;
        stateConfirmed = true;
    }

    return {
      verified: true,
      actionMethod,
      currentState,
      stateConfirmed,
      summary,
    };
  } catch (error) {
    return {
      verified: false,
      actionMethod,
      stateConfirmed: false,
      summary: `Verification failed: ${error}`,
    };
  }
}

// ============================================================================
// Set Value for Sliders/Range Inputs
// ============================================================================

/**
 * Set value on slider, range input, or jQuery UI slider widget.
 * Handles three cases:
 * 1. Native HTML5 range input: Sets element.value directly
 * 2. jQuery UI slider handle: Finds parent slider widget and calls slider('value', X)
 * 3. ARIA slider: Sets aria-valuenow and dispatches appropriate events
 */
async function setValueElement(
    runtimeAgent: ReturnType<CDPSessionAdapter['runtimeAgent']>,
    objectId: string,
    args: unknown[],
    executionContextId?: number,
): Promise<{success: boolean; message: string; actualValue?: number}> {
  const targetValue = args[0];

  // Validate the value argument
  if (typeof targetValue !== 'number' && typeof targetValue !== 'string') {
    return {success: false, message: 'setValue requires a numeric value argument'};
  }

  const numericValue = typeof targetValue === 'string' ? parseFloat(targetValue) : targetValue;

  if (isNaN(numericValue)) {
    return {success: false, message: `Invalid numeric value: ${targetValue}`};
  }

  // CDP requires objectId and executionContextId to be mutually exclusive
  // When objectId is provided, don't pass executionContextId
  const result = await runtimeAgent.invoke<{result?: {value?: unknown}}>('callFunctionOn', {
    objectId,
    // Note: Do NOT pass executionContextId when objectId is provided - they are mutually exclusive in CDP
    functionDeclaration: `
      function(value) {
        // Helper to dispatch events consistently
        function dispatchEvents(el) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Case 1: Native HTML5 range input
        if (this instanceof HTMLInputElement && this.type === 'range') {
          const min = parseFloat(this.min) || 0;
          const max = parseFloat(this.max) || 100;
          const clampedValue = Math.max(min, Math.min(max, value));
          this.value = clampedValue.toString();
          dispatchEvents(this);
          return { success: true, message: 'Set native range input to ' + clampedValue, actualValue: clampedValue };
        }

        // Case 2: Check for jQuery UI slider widget
        const jQuerySlider = this.closest('.ui-slider') || (this.classList && this.classList.contains('ui-slider') ? this : null);
        if (jQuerySlider && typeof jQuery !== 'undefined') {
          try {
            const $slider = jQuery(jQuerySlider);
            if ($slider.slider && typeof $slider.slider === 'function') {
              const options = $slider.slider('option');
              const min = options?.min ?? parseFloat(jQuerySlider.getAttribute('aria-valuemin')) ?? 0;
              const max = options?.max ?? parseFloat(jQuerySlider.getAttribute('aria-valuemax')) ?? 100;
              const clampedValue = Math.max(min, Math.min(max, value));
              $slider.slider('value', clampedValue);
              return { success: true, message: 'Set jQuery UI slider to ' + clampedValue, actualValue: clampedValue };
            }
          } catch (e) {
            console.warn('[setValue] jQuery UI slider method failed:', e);
          }
        }

        // Case 3: ARIA-based slider (generic)
        const ariaSlider = this.closest('[role="slider"]') || (this.getAttribute('role') === 'slider' ? this : null);
        if (ariaSlider) {
          const min = parseFloat(ariaSlider.getAttribute('aria-valuemin')) || 0;
          const max = parseFloat(ariaSlider.getAttribute('aria-valuemax')) || 100;
          const clampedValue = Math.max(min, Math.min(max, value));

          ariaSlider.setAttribute('aria-valuenow', clampedValue.toString());

          // For jQuery UI sliders, also update the handle position visually
          const handle = ariaSlider.querySelector('.ui-slider-handle') || ariaSlider;
          if (handle && handle.style) {
            const percentage = ((clampedValue - min) / (max - min)) * 100;
            if (ariaSlider.classList.contains('ui-slider-vertical')) {
              handle.style.bottom = percentage + '%';
            } else {
              handle.style.left = percentage + '%';
            }
          }

          dispatchEvents(ariaSlider);

          // Try triggering slide event for jQuery UI compatibility
          if (typeof jQuery !== 'undefined') {
            try {
              jQuery(ariaSlider).trigger('slide', { value: clampedValue });
              jQuery(ariaSlider).trigger('slidechange', { value: clampedValue });
            } catch (e) {
              // Ignore if jQuery events fail
            }
          }

          return { success: true, message: 'Set ARIA slider to ' + clampedValue, actualValue: clampedValue };
        }

        // Case 4: Fallback - try setting value property directly
        if ('value' in this) {
          const min = parseFloat(this.min || this.getAttribute('aria-valuemin')) || 0;
          const max = parseFloat(this.max || this.getAttribute('aria-valuemax')) || 100;
          const clampedValue = Math.max(min, Math.min(max, value));
          this.value = clampedValue;
          dispatchEvents(this);
          return { success: true, message: 'Set element value to ' + clampedValue, actualValue: clampedValue };
        }

        return { success: false, message: 'Element does not support value setting. Expected range input, jQuery UI slider, or ARIA slider.' };
      }
    `,
    arguments: [{value: numericValue}],
    returnByValue: true,
  });

  const returnValue = result.result?.value as {success: boolean; message: string; actualValue?: number} | undefined;
  return returnValue ?? {success: false, message: 'setValue execution failed'};
}
