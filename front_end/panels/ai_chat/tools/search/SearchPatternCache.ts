// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../../core/Logger.js';
import type {
  SearchPattern,
  SiteIdentifier,
  PatternExport,
} from './types.js';
import { PATTERN_SCHEMA_VERSION, PATTERN_EXPIRY_MS, FAILURE_RATE_THRESHOLD } from './types.js';

const logger = createLogger('SearchPatternCache');

// Detect if we're in a Node.js environment (eval runner)
const isNodeEnvironment = typeof window === 'undefined' || typeof indexedDB === 'undefined';

/** Database name for search patterns */
const DB_NAME = 'search_patterns_db';
/** Database version */
const DB_VERSION = 1;
/** Object store name */
const STORE_NAME = 'patterns';

/**
 * Manages search pattern caching in IndexedDB with JSON export support.
 * Singleton pattern for connection reuse.
 */
export class SearchPatternCache {
  private static instance: SearchPatternCache | null = null;
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  // In-memory fallback for Node.js (eval runner)
  private memoryCache: Map<SiteIdentifier, SearchPattern> = new Map();

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): SearchPatternCache {
    if (!SearchPatternCache.instance) {
      SearchPatternCache.instance = new SearchPatternCache();
    }
    return SearchPatternCache.instance;
  }

  /**
   * Initialize the database connection
   */
  private async ensureDatabase(): Promise<IDBDatabase | null> {
    // In Node.js, use memory cache instead
    if (isNodeEnvironment) {
      logger.debug('Running in Node.js - using in-memory cache');
      return null;
    }

    if (this.db) {
      return this.db;
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        logger.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        logger.debug('IndexedDB opened successfully');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('site', 'site', { unique: true });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('strategy', 'strategy', { unique: false });
          logger.debug('Created object store and indexes');
        }
      };
    });

    return this.dbPromise;
  }

  /**
   * Generate a UUID for pattern IDs
   */
  private generateUUID(): string {
    // Use crypto.randomUUID if available (modern browsers)
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for older environments
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Get a pattern for a specific site
   */
  async getPattern(site: SiteIdentifier): Promise<SearchPattern | null> {
    const normalizedSite = this.normalizeSite(site);

    // In-memory fallback for Node.js
    if (isNodeEnvironment) {
      return this.memoryCache.get(normalizedSite) || null;
    }

    const db = await this.ensureDatabase();
    if (!db) {
      return this.memoryCache.get(normalizedSite) || null;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('site');
      const request = index.get(normalizedSite);

      request.onsuccess = () => {
        const pattern = request.result as SearchPattern | undefined;

        if (!pattern) {
          resolve(null);
          return;
        }

        // Check if pattern is expired
        if (this.isPatternExpired(pattern)) {
          logger.info(`Pattern for ${site} is expired, returning null`);
          resolve(null);
          return;
        }

        // Check if pattern has too many failures
        if (this.isPatternDegraded(pattern)) {
          logger.info(`Pattern for ${site} has degraded (high failure rate), returning null`);
          resolve(null);
          return;
        }

        resolve(pattern);
      };

      request.onerror = () => {
        logger.error('Failed to get pattern:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Save a new pattern
   */
  async savePattern(pattern: Omit<SearchPattern, 'id' | 'createdAt' | 'lastUsedAt' | 'successCount' | 'failureCount'>): Promise<SearchPattern> {
    const normalizedSite = this.normalizeSite(pattern.site);
    const now = new Date().toISOString();

    const fullPattern: SearchPattern = {
      ...pattern,
      id: this.generateUUID(),
      site: normalizedSite,
      createdAt: now,
      lastUsedAt: now,
      successCount: 0,
      failureCount: 0,
      schemaVersion: PATTERN_SCHEMA_VERSION,
    };

    // In-memory fallback for Node.js
    if (isNodeEnvironment) {
      this.memoryCache.set(normalizedSite, fullPattern);
      logger.debug(`Saved pattern to memory cache for ${normalizedSite}`);
      return fullPattern;
    }

    const db = await this.ensureDatabase();
    if (!db) {
      this.memoryCache.set(normalizedSite, fullPattern);
      return fullPattern;
    }

    // Delete existing pattern for this site (upsert)
    await this.deletePatternBySite(normalizedSite);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(fullPattern);

      request.onsuccess = () => {
        logger.info(`Saved pattern for ${normalizedSite}`);
        // Also update memory cache
        this.memoryCache.set(normalizedSite, fullPattern);
        resolve(fullPattern);
      };

      request.onerror = () => {
        logger.error('Failed to save pattern:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Update an existing pattern
   */
  async updatePattern(id: string, updates: Partial<SearchPattern>): Promise<SearchPattern | null> {
    // In-memory fallback
    if (isNodeEnvironment) {
      for (const [site, pattern] of this.memoryCache) {
        if (pattern.id === id) {
          const updated = { ...pattern, ...updates, lastUsedAt: new Date().toISOString() };
          this.memoryCache.set(site, updated);
          return updated;
        }
      }
      return null;
    }

    const db = await this.ensureDatabase();
    if (!db) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const pattern = getRequest.result as SearchPattern | undefined;
        if (!pattern) {
          resolve(null);
          return;
        }

        const updatedPattern = {
          ...pattern,
          ...updates,
          lastUsedAt: new Date().toISOString(),
        };

        const putRequest = store.put(updatedPattern);
        putRequest.onsuccess = () => {
          // Update memory cache
          this.memoryCache.set(pattern.site, updatedPattern);
          resolve(updatedPattern);
        };
        putRequest.onerror = () => {
          reject(putRequest.error);
        };
      };

      getRequest.onerror = () => {
        reject(getRequest.error);
      };
    });
  }

  /**
   * Record a successful extraction
   */
  async recordSuccess(id: string): Promise<void> {
    const pattern = await this.getPatternById(id);
    if (pattern) {
      await this.updatePattern(id, {
        successCount: pattern.successCount + 1,
      });
    }
  }

  /**
   * Record a failed extraction
   */
  async recordFailure(id: string): Promise<void> {
    const pattern = await this.getPatternById(id);
    if (pattern) {
      await this.updatePattern(id, {
        failureCount: pattern.failureCount + 1,
      });
    }
  }

  /**
   * Update pattern with cached selector
   * This is a specialized update that only modifies the xpathPattern.cachedSelector field
   */
  async updatePatternSelector(id: string, cachedSelector: string): Promise<SearchPattern | null> {
    const pattern = await this.getPatternById(id);
    if (!pattern) {
      logger.warn(`Pattern ${id} not found for selector update`);
      return null;
    }

    if (!pattern.xpathPattern) {
      logger.warn(`Pattern ${id} has no xpathPattern`);
      return null;
    }

    // Update the xpathPattern with the cached selector
    const updatedXpathPattern = {
      ...pattern.xpathPattern,
      cachedSelector,
    };

    return this.updatePattern(id, {
      xpathPattern: updatedXpathPattern,
    });
  }

  /**
   * Delete a pattern by ID
   */
  async deletePattern(id: string): Promise<void> {
    // In-memory fallback
    if (isNodeEnvironment) {
      for (const [site, pattern] of this.memoryCache) {
        if (pattern.id === id) {
          this.memoryCache.delete(site);
          return;
        }
      }
      return;
    }

    const db = await this.ensureDatabase();
    if (!db) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
        logger.info(`Deleted pattern ${id}`);
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Delete pattern by site
   */
  private async deletePatternBySite(site: SiteIdentifier): Promise<void> {
    const existing = await this.getPattern(site);
    if (existing) {
      await this.deletePattern(existing.id);
    }
  }

  /**
   * Get all patterns
   */
  async getAllPatterns(): Promise<SearchPattern[]> {
    // In-memory fallback
    if (isNodeEnvironment) {
      return Array.from(this.memoryCache.values());
    }

    const db = await this.ensureDatabase();
    if (!db) {
      return Array.from(this.memoryCache.values());
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result as SearchPattern[]);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Export all patterns to JSON
   */
  async exportToJSON(): Promise<string> {
    const patterns = await this.getAllPatterns();

    const exportData: PatternExport = {
      version: PATTERN_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      patterns,
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import patterns from JSON
   * @returns Number of patterns imported
   */
  async importFromJSON(json: string): Promise<number> {
    const data: PatternExport = JSON.parse(json);

    if (!data.patterns || !Array.isArray(data.patterns)) {
      throw new Error('Invalid pattern export format');
    }

    let importedCount = 0;
    for (const pattern of data.patterns) {
      try {
        // Validate pattern has required fields
        if (!pattern.site || !pattern.strategy) {
          logger.warn(`Skipping invalid pattern: missing site or strategy`);
          continue;
        }

        // Save pattern (will upsert if exists)
        await this.savePattern(pattern);
        importedCount++;
      } catch (error) {
        logger.error(`Failed to import pattern for ${pattern.site}:`, error);
      }
    }

    logger.info(`Imported ${importedCount} patterns`);
    return importedCount;
  }

  /**
   * Clear all cached patterns
   */
  async clearCache(): Promise<void> {
    this.memoryCache.clear();

    if (isNodeEnvironment) {
      return;
    }

    const db = await this.ensureDatabase();
    if (!db) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        logger.info('Cleared pattern cache');
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Get pattern by ID
   */
  private async getPatternById(id: string): Promise<SearchPattern | null> {
    // In-memory fallback
    if (isNodeEnvironment) {
      for (const pattern of this.memoryCache.values()) {
        if (pattern.id === id) {
          return pattern;
        }
      }
      return null;
    }

    const db = await this.ensureDatabase();
    if (!db) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result as SearchPattern | undefined || null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Normalize site identifier (extract domain)
   */
  private normalizeSite(site: string): SiteIdentifier {
    // Remove protocol
    let normalized = site.replace(/^https?:\/\//, '');
    // Remove www prefix
    normalized = normalized.replace(/^www\./, '');
    // Remove path and query string
    normalized = normalized.split('/')[0];
    normalized = normalized.split('?')[0];
    // Convert to lowercase
    normalized = normalized.toLowerCase();
    return normalized;
  }

  /**
   * Check if pattern is expired
   */
  private isPatternExpired(pattern: SearchPattern): boolean {
    const createdAt = new Date(pattern.createdAt).getTime();
    const now = Date.now();
    return now - createdAt > PATTERN_EXPIRY_MS;
  }

  /**
   * Check if pattern has degraded (high failure rate)
   */
  private isPatternDegraded(pattern: SearchPattern): boolean {
    const totalUses = pattern.successCount + pattern.failureCount;
    if (totalUses < 5) {
      // Not enough data to determine
      return false;
    }
    const failureRate = pattern.failureCount / totalUses;
    return failureRate > FAILURE_RATE_THRESHOLD;
  }
}
