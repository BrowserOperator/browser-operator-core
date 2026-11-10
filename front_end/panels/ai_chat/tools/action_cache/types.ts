// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Action Cache Types
 *
 * Defines interfaces for caching element XPaths after successful actions.
 * The LLM generates a semantic intent on first action, and subsequent
 * actions use the cached XPath without LLM.
 */

/** Unique identifier for cached patterns: "site/path:intent" */
export type ActionCacheKey = string;

/** Schema version for cache invalidation on breaking changes */
export const ACTION_CACHE_SCHEMA_VERSION = '1.0.0';

/** Cache entry expiry in milliseconds (30 days) */
export const ACTION_CACHE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/** Failure rate threshold for cache invalidation (30%) */
export const ACTION_FAILURE_RATE_THRESHOLD = 0.3;

/**
 * Captured element attributes for fallback matching
 */
export interface ElementAttributes {
  /** Element id attribute */
  idAttr?: string;
  /** Element name attribute */
  nameAttr?: string;
  /** ARIA label */
  ariaLabel?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Input type (text, email, password, etc.) */
  inputType?: string;
  /** HTML tag name */
  tagName?: string;
  /** Role attribute */
  role?: string;
  /** Text content (for buttons/links) */
  textContent?: string;
}

/**
 * Cached action pattern - stores XPath and attributes for element lookup
 */
export interface CachedActionPattern {
  /** Unique pattern identifier (UUID) */
  id: string;

  /** Cache key for lookup: "google.com/:search-input" */
  cacheKey: ActionCacheKey;

  /** Normalized domain: "google.com" */
  site: string;

  /** URL path pattern: "/", "/login", "/dp" */
  pathPattern: string;

  /** LLM-generated semantic intent: "search-input", "add-to-cart" */
  semanticIntent: string;

  /** Primary XPath for element lookup */
  xpath: string;

  /** Fallback CSS selector */
  cssSelector?: string;

  /** Element attributes for validation/fallback matching */
  attributes: ElementAttributes;

  /** ISO timestamp of pattern creation */
  createdAt: string;

  /** ISO timestamp of last successful use */
  lastUsedAt: string;

  /** Number of successful uses */
  successCount: number;

  /** Number of failed lookups */
  failureCount: number;

  /** Schema version for cache invalidation */
  schemaVersion: string;
}

/**
 * Result of looking up an element via cached pattern
 */
export interface CacheLookupResult {
  /** Whether a cached pattern was found */
  found: boolean;

  /** The cached pattern if found */
  pattern?: CachedActionPattern;

  /** The resolved EncodedId if element was found */
  encodedId?: string;

  /** Whether the cached XPath successfully found an element */
  xpathSuccess?: boolean;

  /** Error message if lookup failed */
  error?: string;
}

/**
 * Result of executing an action with caching
 */
export interface CachedActionResult {
  /** Whether the action was successful */
  success: boolean;

  /** Whether a cached pattern was used (vs LLM) */
  usedCache: boolean;

  /** Cache key used/generated */
  cacheKey?: ActionCacheKey;

  /** The semantic intent (from cache or LLM) */
  semanticIntent?: string;

  /** Error message if failed */
  error?: string;

  /** The EncodedId that was acted upon */
  targetEncodedId?: string;

  /** Whether the page changed after action */
  pageChanged?: boolean;
}

/**
 * Input for ActionAgentV2 - includes optional semantic intent for cache lookup
 */
export interface ActionAgentV2Input {
  /** Natural language objective */
  objective: string;

  /** Reasoning for the action */
  reasoning: string;

  /** Optional hint from previous failures */
  hint?: string;

  /** Optional input data for form filling */
  input_data?: string;

  /** Optional semantic intent for cache lookup (if known) */
  semantic_intent?: string;
}

/**
 * perform_action tool call with semantic_intent from LLM
 */
export interface PerformActionWithIntent {
  /** Action method: click, fill, selectOption, etc. */
  method: string;

  /** EncodedId of target element */
  nodeId: string;

  /** LLM's reasoning for this action */
  reasoning?: string;

  /** LLM-generated semantic intent for caching */
  semantic_intent: string;

  /** Optional args (for fill, selectOption, etc.) */
  args?: Record<string, unknown>;
}
