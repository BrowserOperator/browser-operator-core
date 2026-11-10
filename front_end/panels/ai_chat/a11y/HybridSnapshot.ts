// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Hybrid Accessibility Snapshot
 *
 * Captures a frame-aware accessibility tree with EncodedId→XPath mapping.
 * This combines DOM structure with accessibility tree information to provide
 * rich page representation for AI-driven element targeting.
 *
 */

import * as SDK from '../../../core/sdk/sdk.js';
import type * as Protocol from '../../../generated/protocol.js';

import {FrameRegistry, type FrameInfo} from './FrameRegistry.js';
import {type EncodedId, makeEncodedId} from '../common/context.js';

/**
 * Options for capturing a hybrid snapshot
 */
export interface SnapshotOptions {
  /** Scope to a specific subtree using a selector */
  focusSelector?: string;
  /** Include shadow DOM in the snapshot (default: true) */
  pierceShadow?: boolean;
}

/**
 * Per-frame snapshot data
 */
export interface FrameSnapshot {
  frameId: string;
  ordinal: number;
  url: string;
  outline: string;
  xpathMap: Record<EncodedId, string>;
  urlMap: Record<EncodedId, string>;
}

/**
 * Complete hybrid snapshot across all frames
 */
export interface HybridSnapshot {
  /** Human-readable merged accessibility tree */
  combinedTree: string;
  /** EncodedId → absolute XPath (including iframe prefixes) */
  combinedXpathMap: Record<EncodedId, string>;
  /** EncodedId → URL (for links and images) */
  combinedUrlMap: Record<EncodedId, string>;
  /** Per-frame snapshot data for debugging */
  perFrame: FrameSnapshot[];
}

// ============================================================================
// XPath Utilities
// ============================================================================

/**
 * Join two XPath segments.
 * Handles shadow root hops ('//' markers) correctly.
 */
function joinXPath(base: string, step: string): string {
  // Shadow root hop marker
  if (step === '//') {
    if (!base || base === '/') {
      return '//';
    }
    return base.endsWith('/') ? `${base}/` : `${base}//`;
  }

  if (!base || base === '/') {
    return step ? `/${step}` : '/';
  }

  if (base.endsWith('//')) {
    return `${base}${step}`;
  }

  if (!step) {
    return base;
  }

  return `${base}/${step}`;
}

/**
 * Prefix a child XPath with an absolute parent iframe path.
 */
function prefixXPath(parentAbs: string, child: string): string {
  const p = parentAbs === '/' ? '' : parentAbs.replace(/\/$/, '');

  if (!child || child === '/') {
    return p || '/';
  }

  if (child.startsWith('//')) {
    return p ? `${p}//${child.slice(2)}` : `//${child.slice(2)}`;
  }

  const c = child.replace(/^\//, '');
  return p ? `${p}/${c}` : `/${c}`;
}

// ============================================================================
// DOM Map Building
// ============================================================================

interface DomMaps {
  tagNameMap: Record<EncodedId, string>;
  xpathMap: Record<EncodedId, string>;
  scrollableMap: Record<EncodedId, boolean>;
}

/**
 * Build DOM maps for a single frame.
 * Traverses the DOM tree and builds XPath for each element.
 */
async function buildDomMaps(
    domModel: SDK.DOMModel.DOMModel,
    frameRegistry: FrameRegistry,
    frameId: string,
    pierce: boolean,
): Promise<DomMaps> {
  const tagNameMap: Record<EncodedId, string> = {};
  const xpathMap: Record<EncodedId, string> = {};
  const scrollableMap: Record<EncodedId, boolean> = {};

  const ordinal = frameRegistry.getOrdinal(frameId);
  const encode = (backendNodeId: number): EncodedId => makeEncodedId(ordinal, backendNodeId);

  // Request document with pierce option for shadow DOM
  const document = await domModel.requestDocument();
  if (!document) {
    return {tagNameMap, xpathMap, scrollableMap};
  }

  // DFS traversal of the DOM
  interface StackEntry {
    node: SDK.DOMModel.DOMNode;
    xpath: string;
  }

  const stack: StackEntry[] = [{node: document, xpath: ''}];

  while (stack.length) {
    const entry = stack.pop();
    if (!entry) {
      continue;
    }

    const {node, xpath} = entry;
    const backendNodeId = node.backendNodeId();

    if (backendNodeId) {
      const encId = encode(backendNodeId);
      tagNameMap[encId] = node.localName() || node.nodeName().toLowerCase();
      xpathMap[encId] = xpath || '/';
    }

    // Process children with sibling-indexed XPath segments
    const children = node.children() || [];
    if (children.length) {
      // Build sibling-indexed segments
      const segs: string[] = [];
      const counter: Record<string, number> = {};

      for (const child of children) {
        const tag = child.localName() || child.nodeName().toLowerCase();
        const nodeType = child.nodeType();
        const key = `${nodeType}:${tag}`;
        const idx = (counter[key] = (counter[key] ?? 0) + 1);

        if (nodeType === Node.TEXT_NODE) {
          segs.push(`text()[${idx}]`);
        } else if (nodeType === Node.COMMENT_NODE) {
          segs.push(`comment()[${idx}]`);
        } else if (tag.includes(':')) {
          // Namespaced tag
          segs.push(`*[name()='${tag}'][${idx}]`);
        } else {
          segs.push(`${tag}[${idx}]`);
        }
      }

      // Add children to stack in reverse order for correct processing
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({
          node: children[i],
          xpath: joinXPath(xpath, segs[i]),
        });
      }
    }

    // Process shadow roots with '//' hop marker
    const shadowRoots = node.shadowRoots() || [];
    for (const sr of shadowRoots) {
      stack.push({
        node: sr,
        xpath: joinXPath(xpath, '//'),
      });
    }
  }

  return {tagNameMap, xpathMap, scrollableMap};
}

// ============================================================================
// Accessibility Tree Building
// ============================================================================

interface A11yOutline {
  outline: string;
  urlMap: Record<EncodedId, string>;
}

/**
 * Build accessibility tree outline for a single frame.
 */
async function buildA11yOutline(
    target: SDK.Target.Target,
    frameId: string,
    frameRegistry: FrameRegistry,
    tagNameMap: Record<EncodedId, string>,
): Promise<A11yOutline> {
  const urlMap: Record<EncodedId, string> = {};
  const ordinal = frameRegistry.getOrdinal(frameId);
  const encode = (backendNodeId: number): EncodedId => makeEncodedId(ordinal, backendNodeId);

  // Request full accessibility tree for the frame
  let axNodes: Protocol.Accessibility.AXNode[] = [];
  try {
    const accessibilityAgent = target.accessibilityAgent();
    const response = await accessibilityAgent.invoke_getFullAXTree({frameId: frameId as Protocol.Page.FrameId});
    axNodes = response.nodes || [];
  } catch {
    // Frame may have been removed or is an OOPIF
    return {outline: '', urlMap};
  }

  if (!axNodes.length) {
    return {outline: '', urlMap};
  }

  // Build node map for tree traversal
  const nodeMap = new Map<string, Protocol.Accessibility.AXNode>();
  for (const node of axNodes) {
    nodeMap.set(node.nodeId, node);
  }

  // Format a single node
  const lines: string[] = [];

  const formatNode = (node: Protocol.Accessibility.AXNode, indent: number): void => {
    const role = node.role?.value ?? '';
    const name = node.name?.value ?? '';
    const backendNodeId = node.backendDOMNodeId;

    let labelId = '';
    if (typeof backendNodeId === 'number') {
      labelId = encode(backendNodeId);

      // Extract URL from properties
      const urlProp = node.properties?.find((p: Protocol.Accessibility.AXProperty) => p.name === 'url');
      if (urlProp?.value?.value) {
        urlMap[labelId as EncodedId] = String(urlProp.value.value);
      }
    }

    // Decorate role with tag name for generic roles
    let displayRole = role;
    if ((role === 'generic' || role === 'none') && labelId && tagNameMap[labelId as EncodedId]) {
      displayRole = tagNameMap[labelId as EncodedId];
    }

    const prefix = '  '.repeat(indent);
    const nameStr = name ? `: ${cleanText(name)}` : '';
    const label = `[${labelId || node.nodeId}] ${displayRole}${nameStr}`;
    lines.push(`${prefix}${label}`);
  };

  // DFS traversal to build outline
  const visit = (nodeId: string, indent: number): void => {
    const node = nodeMap.get(nodeId);
    if (!node) {
      return;
    }

    formatNode(node, indent);

    for (const childId of node.childIds || []) {
      visit(childId, indent + 1);
    }
  };

  // Start from root nodes (no parent)
  const roots = axNodes.filter(n => !n.parentId);
  for (const root of roots) {
    visit(root.nodeId, 0);
  }

  return {outline: lines.join('\n'), urlMap};
}

/**
 * Clean text for display (remove private use area characters, normalize whitespace)
 */
function cleanText(input: string): string {
  const PUA_START = 0xe000;
  const PUA_END = 0xf8ff;
  const NBSP_CHARS = new Set([0x00a0, 0x202f, 0x2007, 0xfeff]);

  let out = '';
  let prevSpace = false;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);

    // Skip private use area characters
    if (code >= PUA_START && code <= PUA_END) {
      continue;
    }

    // Normalize non-breaking spaces
    if (NBSP_CHARS.has(code)) {
      if (!prevSpace) {
        out += ' ';
        prevSpace = true;
      }
      continue;
    }

    out += input[i];
    prevSpace = input[i] === ' ';
  }

  return out.trim();
}

// ============================================================================
// Main Snapshot Function
// ============================================================================

/**
 * Capture a hybrid accessibility snapshot across all frames.
 * Returns a combined tree with EncodedId→XPath mapping for element targeting.
 */
export async function captureHybridSnapshot(
    target: SDK.Target.Target,
    options?: SnapshotOptions,
): Promise<HybridSnapshot> {
  const pierce = options?.pierceShadow ?? true;

  // Initialize frame registry
  const frameRegistry = new FrameRegistry(target);
  await frameRegistry.collectFrames();

  const frames = frameRegistry.listAllFrameIds();
  const parentByFrame = frameRegistry.getParentMap();

  // Output maps
  const combinedXpathMap: Record<EncodedId, string> = {};
  const combinedUrlMap: Record<EncodedId, string> = {};
  const perFrame: FrameSnapshot[] = [];

  // Absolute XPath prefix for each frame (empty for main frame)
  const absPrefix = new Map<string, string>();
  const mainFrameId = frames[0];
  if (mainFrameId) {
    absPrefix.set(mainFrameId, '');
  }

  // Get models
  const domModel = target.model(SDK.DOMModel.DOMModel);

  if (!domModel) {
    return {combinedTree: '', combinedXpathMap, combinedUrlMap, perFrame};
  }

  // Process each frame
  for (const frameId of frames) {
    const frameInfo = frameRegistry.getFrame(frameId);
    if (!frameInfo) {
      continue;
    }

    // Build DOM maps
    const {tagNameMap, xpathMap, scrollableMap} = await buildDomMaps(
        domModel,
        frameRegistry,
        frameId,
        pierce,
    );

    // Build accessibility outline
    const {outline, urlMap} = await buildA11yOutline(
        target,
        frameId,
        frameRegistry,
        tagNameMap,
    );

    // Compute absolute prefix for child frames
    const parentId = parentByFrame.get(frameId);
    if (parentId && frameInfo.ownerBackendNodeId) {
      const parentOrdinal = frameRegistry.getOrdinal(parentId);
      const iframeEncId = makeEncodedId(parentOrdinal, frameInfo.ownerBackendNodeId);
      const parentPrefix = absPrefix.get(parentId) ?? '';
      const iframeXPath = combinedXpathMap[iframeEncId];

      if (iframeXPath) {
        absPrefix.set(frameId, prefixXPath(parentPrefix || '/', iframeXPath));
      } else {
        absPrefix.set(frameId, parentPrefix);
      }
    }

    // Apply absolute prefix to XPaths
    const framePrefix = absPrefix.get(frameId) ?? '';
    const prefixedXpathMap: Record<EncodedId, string> = {};

    for (const [encId, xp] of Object.entries(xpathMap)) {
      const absoluteXPath = framePrefix ? prefixXPath(framePrefix, xp) : xp;
      prefixedXpathMap[encId as EncodedId] = absoluteXPath;
      combinedXpathMap[encId as EncodedId] = absoluteXPath;
    }

    // Merge URL map
    Object.assign(combinedUrlMap, urlMap);

    perFrame.push({
      frameId,
      ordinal: frameInfo.ordinal,
      url: frameInfo.url,
      outline,
      xpathMap: prefixedXpathMap,
      urlMap,
    });
  }

  // Stitch combined tree (main frame first, then children separated by blank lines)
  const combinedTree = perFrame
      .map(f => f.outline)
      .filter(Boolean)
      .join('\n\n');

  return {combinedTree, combinedXpathMap, combinedUrlMap, perFrame};
}

/**
 * Helper to resolve an EncodedId to its absolute XPath.
 */
export function resolveEncodedIdToXPath(
    snapshot: HybridSnapshot,
    encodedId: EncodedId,
): string|undefined {
  return snapshot.combinedXpathMap[encodedId];
}

/**
 * Helper to resolve an EncodedId to its URL (if it's a link or image).
 */
export function resolveEncodedIdToUrl(
    snapshot: HybridSnapshot,
    encodedId: EncodedId,
): string|undefined {
  return snapshot.combinedUrlMap[encodedId];
}
