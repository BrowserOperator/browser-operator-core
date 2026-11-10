// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { SchemaDefinition } from '../SchemaBasedExtractorTool.js';

/**
 * Unique identifier for a search pattern (site domain)
 */
export type SiteIdentifier = string;

/**
 * Search result extracted from a page
 */
export interface SearchResult {
  /** Result title text */
  title: string;
  /** URL of the result */
  url: string;
  /** Snippet/description text */
  snippet?: string;
  /** Position in results (1-indexed) */
  position: number;
  /** Additional site-specific fields */
  additionalFields?: Record<string, unknown>;
}

/**
 * XPath-based pattern for locating and extracting search results
 */
export interface XPathPattern {
  /** XPath to the search input element */
  searchInputXPath: string;
  /** XPath to the submit button (optional - can use Enter key) */
  submitButtonXPath?: string;
  /** Schema for extracting results using SchemaBasedExtractorTool */
  resultsSchema: SchemaDefinition;
  /** Instruction for the extraction LLM */
  extractionInstruction: string;
  /**
   * Cached JavaScript selector for fast extraction (bypasses LLM).
   * Generated after first successful LLM extraction, executed via Runtime.evaluate.
   */
  cachedSelector?: string;

  // ============ ALTERNATIVE STRATEGIES ============
  // These provide more resilient extraction than CSS-based cachedSelector

  /** Semantic XPath pattern - uses ARIA roles and text content */
  semanticXPath?: SemanticXPathPattern;
  /** EncodedId pattern - parses accessibility tree directly */
  encodedIdPattern?: EncodedIdPattern;
  /** Text/content pattern - matches by URL patterns and text filters */
  textPattern?: TextContentPattern;
}

/**
 * Semantic XPath pattern - more resilient than CSS selectors.
 * Uses ARIA roles and text content which are stable for accessibility/SEO.
 */
export interface SemanticXPathPattern {
  /** Role-based XPath for finding result containers (e.g., "//a[@role='link' or local-name()='a']") */
  roleBasedXPath: string;
  /** Field extraction XPaths relative to each result element */
  fieldMappings: {
    /** XPath for title relative to result element */
    title: string;
    /** XPath for URL (often the element itself for links) */
    url: string;
    /** XPath for snippet/description relative to result element */
    snippet: string;
  };
  /** URL filter: 'external' filters out site-internal links */
  urlFilter: 'external' | 'internal' | 'any';
  /** Optional: navigation exclusion XPath predicates */
  navigationExclusions?: string[];
}

/**
 * EncodedId pattern - parses accessibility tree text directly.
 * Fastest execution: no DOM traversal, pure string parsing.
 */
export interface EncodedIdPattern {
  /** Target accessibility role (e.g., 'link', 'button') */
  targetRole: string;
  /** Regex pattern for filtering URLs (e.g., "^https?://(?!.*google\\.com)") */
  urlRegex: string;
  /** Optional parent role hint for context (e.g., 'main', 'article') */
  parentRoleHint?: string;
  /** Minimum text length for result titles */
  minTextLength?: number;
  /** Text patterns to exclude (e.g., ["Ad", "Sponsored"]) */
  excludeTextPatterns?: string[];
}

/**
 * Text/content pattern - matches by URL patterns and text filters.
 * URLs are the most stable element of search results.
 */
export interface TextContentPattern {
  /** Compiled XPath with URL exclusions and text filters */
  compiledXPath: string;
  /** URL substrings to exclude (e.g., ["google.com", "accounts."]) */
  urlExclusions: string[];
  /** Minimum text length for valid results */
  minTextLength: number;
  /** Whether to exclude elements inside nav/header/footer */
  excludeNavigation: boolean;
  /** Additional URL patterns that indicate external results */
  externalUrlIndicators?: string[];
}

/**
 * CDP-based pattern (for future extensibility)
 */
export interface CDPPattern {
  /** CSS selectors for key elements */
  selectors: Record<string, string>;
  /** CDP evaluation script for extraction */
  extractionScript: string;
}

/**
 * JavaScript evaluation pattern (for future extensibility)
 */
export interface JSPattern {
  /** JavaScript code to evaluate in page context */
  evaluationScript: string;
  /** Schema for result validation */
  schema: SchemaDefinition;
}

/**
 * A cached search pattern for a specific site
 */
export interface SearchPattern {
  /** Unique identifier (UUID) */
  id: string;
  /** Site domain (e.g., "google.com") */
  site: SiteIdentifier;
  /** Pattern version for schema migrations */
  version: number;
  /** Strategy that created this pattern */
  strategy: SearchStrategyType;
  /** ISO timestamp when pattern was created */
  createdAt: string;
  /** ISO timestamp when pattern was last used */
  lastUsedAt: string;
  /** Number of successful extractions */
  successCount: number;
  /** Number of failed extractions */
  failureCount: number;

  /** XPath-based pattern (primary strategy) */
  xpathPattern?: XPathPattern;
  /** CDP-based pattern (future) */
  cdpPattern?: CDPPattern;
  /** JS evaluation pattern (future) */
  jsPattern?: JSPattern;

  /** Sample query used to generate pattern */
  sampleQuery?: string;
  /** Schema version for compatibility checking */
  schemaVersion: string;
}

/**
 * Supported search strategy types
 */
export type SearchStrategyType =
  | 'xpath-schema'      // Original: LLM extraction + CSS selector caching
  | 'semantic-xpath'    // New: XPath with ARIA roles and text content
  | 'encoded-id'        // New: Parse accessibility tree directly
  | 'text-pattern'      // New: URL patterns and text filters
  | 'xpath-llm'         // New: LLM with XPath-enhanced snapshot
  | 'css-llm'           // New: LLM with CSS-enhanced snapshot
  | 'cdp'               // Future: CDP-based
  | 'js-eval';          // Future: JavaScript evaluation

/**
 * Arguments for the SearchTool
 */
export interface SearchToolArgs {
  /** Search query */
  query: string;
  /** Site URL or identifier (e.g., "google.com", "https://amazon.com") */
  site: string;
  /** Maximum results to return (default: 10) */
  maxResults?: number;
  /** Force pattern regeneration even if cached */
  forceRefresh?: boolean;
  /** Override strategy selection */
  strategy?: SearchStrategyType;
  /** Reasoning for the search (displayed to user) */
  reasoning: string;
}

/**
 * Result from the SearchTool
 */
export interface SearchToolResult {
  /** Whether the search succeeded */
  success: boolean;
  /** Extracted search results */
  results: SearchResult[];
  /** Pattern used for extraction */
  pattern?: SearchPattern;
  /** Whether pattern was from cache */
  cached: boolean;
  /** Metadata about the execution */
  metadata?: {
    site: string;
    query: string;
    resultCount: number;
    strategy: SearchStrategyType;
    executionTimeMs: number;
  };
  /** Error message if failed */
  error?: string;
}

/**
 * Options for pattern generation
 */
export interface PatternGenerationOptions {
  /** Site domain */
  site: SiteIdentifier;
  /** Sample query for testing the pattern */
  sampleQuery: string;
  /** Strategy to use */
  strategy: SearchStrategyType;
}

/**
 * Result of pattern generation
 */
export interface PatternGenerationResult {
  /** Whether generation succeeded */
  success: boolean;
  /** Generated pattern */
  pattern?: SearchPattern;
  /** Error message if failed */
  error?: string;
}

/**
 * Options for pattern execution
 */
export interface PatternExecutionOptions {
  /** Pattern to execute */
  pattern: SearchPattern;
  /** Search query */
  query: string;
  /** Maximum results to extract */
  maxResults: number;
}

/**
 * Result of pattern execution
 */
export interface PatternExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Extracted results */
  results: SearchResult[];
  /** Error message if failed */
  error?: string;
}

/**
 * JSON export format for patterns
 */
export interface PatternExport {
  /** Export format version */
  version: string;
  /** ISO timestamp of export */
  exportedAt: string;
  /** Exported patterns */
  patterns: SearchPattern[];
}

/**
 * Configuration for well-known search sites
 */
export interface SiteConfig {
  /** Site domain */
  site: SiteIdentifier;
  /** Human-readable name */
  displayName: string;
  /** URL template with {query} placeholder */
  searchUrl: string;
  /** Preferred strategy for this site */
  preferredStrategy: SearchStrategyType;
  /** Hints for pattern generation */
  hints?: {
    /** Hint for finding search input */
    searchInputHint?: string;
    /** Hint for finding results container */
    resultsContainerHint?: string;
    /** How long to wait for results (ms) */
    waitTimeMs?: number;
  };
}

/** Current schema version for patterns */
export const PATTERN_SCHEMA_VERSION = '1.0.0';

/** Default results limit */
export const DEFAULT_MAX_RESULTS = 10;

/** Pattern cache expiry time (30 days) */
export const PATTERN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/** Failure rate threshold for invalidation (30%) */
export const FAILURE_RATE_THRESHOLD = 0.3;

/**
 * Score for evaluating a generated selector's quality
 */
export interface SelectorScore {
  /** What % of ground truth results were found (0-1) */
  coverage: number;
  /** What % of results are unique (0-1, 1 = no duplicates) */
  uniqueRate: number;
  /** Total results found by selector */
  totalFound: number;
  /** Whether selector found at least as many as ground truth */
  scalable: boolean;
  /** Whether selector meets minimum quality threshold */
  valid: boolean;
  /** Whether selector is perfect (high coverage, no duplicates, scalable) */
  perfect: boolean;
  /** Feedback message for LLM to improve on next iteration */
  feedback: string;
}
