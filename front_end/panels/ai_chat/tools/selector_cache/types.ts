// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Shared types for cached selector extraction
 */

/** Cache key identifier (domain + path pattern + schema hash) */
export type CacheKeyIdentifier = string;

/**
 * Cached JavaScript selector for data extraction
 */
export interface CachedSelector {
  /** Unique ID (UUID) */
  id: string;
  /** Cache key (domain + path pattern + schema hash) */
  cacheKey: CacheKeyIdentifier;
  /** Executable JavaScript code (IIFE returning array/object) */
  selectorScript: string;
  /** Schema hash for invalidation */
  schemaHash: string;
  /** Creation timestamp (ISO string) */
  createdAt: string;
  /** Last used timestamp (ISO string) */
  lastUsedAt: string;
  /** Success count */
  successCount: number;
  /** Failure count */
  failureCount: number;
  /** Schema version for migrations */
  schemaVersion: string;
}

/**
 * Score for evaluating selector quality against ground truth
 */
export interface SelectorScore {
  /** Coverage: % of ground truth results found (0-1) */
  coverage: number;
  /** Uniqueness: % of results that are unique (0-1, 1 = no duplicates) */
  uniqueRate: number;
  /** Total results found by selector */
  totalFound: number;
  /** Whether selector meets minimum quality threshold */
  valid: boolean;
  /** Whether selector is perfect (high coverage, no duplicates, scalable) */
  perfect: boolean;
  /** Feedback message for LLM to improve on next iteration */
  feedback: string;
}

/**
 * Arguments for the extract_cached tool
 */
export interface CachedSchemaExtractionArgs {
  /** JSON Schema definition of data to extract */
  schema: object;
  /** Natural language instruction for extraction */
  instruction: string;
  /** Reasoning about the extraction (displayed to user) */
  reasoning?: string;
  /** Optional custom cache key (overrides auto-generation) */
  cacheKey?: string;
  /** Path pattern for cache key generation (e.g., "/search", "/products") */
  pathPattern?: string;
  /** Force cache refresh even if cached selector exists */
  forceRefresh?: boolean;
}

/**
 * Result from the extract_cached tool
 */
export interface CachedSchemaExtractionResult {
  /** Whether extraction succeeded */
  success: boolean;
  /** Extracted data (or null on failure) */
  data: unknown | null;
  /** Error message if failed */
  error?: string;
  /** Whether result was from cache */
  cached: boolean;
  /** Cache key used */
  cacheKey?: string;
  /** Execution time in milliseconds */
  executionTimeMs?: number;
}

/** Current schema version for selectors */
export const SELECTOR_SCHEMA_VERSION = '1.0.0';

/** Selector cache expiry time (30 days) */
export const SELECTOR_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/** Failure rate threshold for invalidation (30%) */
export const FAILURE_RATE_THRESHOLD = 0.3;
