// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * DOM Module Index
 *
 * Exports all DOM-related utilities for shadow DOM piercing,
 * composed tree resolution, and enhanced element targeting.
 */

// Shadow Piercer - Runtime script injection for closed shadow root access
export {
  SHADOW_PIERCER_RUNTIME,
  injectShadowPiercer,
  isPiercerInstalled,
  getPiercerStats,
  ensurePiercerInjected,
  type BrowserOperatorBackdoor,
} from './ShadowPiercer.js';

// Composed Tree Resolver - XPath/CSS resolution through shadow DOM
export {
  parseHopNotation,
  parseXPathToSteps,
  buildXPathFromSteps,
  isIframeStep,
  resolveComposedXPath,
  resolveComposedCss,
  resolveSelector,
  type HopResult,
  type ResolvedElement,
} from './ComposedTreeResolver.js';

// Element Resolver - High-level element resolution API
export {
  resolveElement,
  resolveXPath,
  resolveCssSelector,
  type ResolveOptions,
  type ElementResolutionResult,
} from './ElementResolver.js';

// Enhanced Element Resolver - Smart resolution with EncodedId support
export {
  resolveByEncodedId,
  resolveByXPathEnhanced,
  resolveByCssSelectorEnhanced,
  resolveByBackendNodeId,
  resolveElementSmart,
  type EnhancedResolutionResult,
} from './EnhancedElementResolver.js';
