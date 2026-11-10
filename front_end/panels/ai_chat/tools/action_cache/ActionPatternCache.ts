// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../../core/Logger.js';
import type {
  CachedActionPattern,
  ActionCacheKey,
  ElementAttributes,
} from './types.js';
import {
  ACTION_CACHE_SCHEMA_VERSION,
  ACTION_CACHE_EXPIRY_MS,
  ACTION_FAILURE_RATE_THRESHOLD,
} from './types.js';

const logger = createLogger('ActionPatternCache');

// Detect if we're in a Node.js environment (eval runner)
const isNodeEnvironment = typeof window === 'undefined' || typeof indexedDB === 'undefined';

/** File path for Node.js file-based persistence */
const CACHE_FILE_PATH = '.action-pattern-cache.json';

/** Database name for action pattern cache */
const DB_NAME = 'action_pattern_cache_db';
/** Database version */
const DB_VERSION = 1;
/** Object store name */
const STORE_NAME = 'action_patterns';

/**
 * Manages cached action patterns for fast element lookup.
 * Uses IndexedDB for browser persistence, in-memory Map for Node.js.
 * Singleton pattern for connection reuse.
 */
export class ActionPatternCache {
  private static instance: ActionPatternCache | null = null;
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  // In-memory fallback for Node.js (eval runner)
  private memoryCache: Map<ActionCacheKey, CachedActionPattern> = new Map();

  // File-based persistence for Node.js
  private fileLoaded = false;
  private fileLoadPromise: Promise<void> | null = null;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): ActionPatternCache {
    if (!ActionPatternCache.instance) {
      ActionPatternCache.instance = new ActionPatternCache();
    }
    return ActionPatternCache.instance;
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
          store.createIndex('cacheKey', 'cacheKey', { unique: true });
          store.createIndex('site', 'site', { unique: false });
          store.createIndex('semanticIntent', 'semanticIntent', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          logger.debug('Created object store and indexes');
        }
      };
    });

    return this.dbPromise;
  }

  /**
   * Load cached patterns from file (Node.js only)
   */
  private async loadFromFile(): Promise<void> {
    if (!isNodeEnvironment) {
      return;
    }

    if (this.fileLoaded) {
      return;
    }

    if (this.fileLoadPromise) {
      return this.fileLoadPromise;
    }

    this.fileLoadPromise = (async () => {
      try {
        // @ts-ignore - fs/promises is only available in Node.js
        const fs = await import('fs/promises');
        const data = await fs.readFile(CACHE_FILE_PATH, 'utf-8');
        const patterns: CachedActionPattern[] = JSON.parse(data);
        for (const pattern of patterns) {
          // Skip expired or degraded patterns
          if (!this.isExpired(pattern) && !this.isDegraded(pattern)) {
            this.memoryCache.set(pattern.cacheKey, pattern);
          }
        }
        logger.info(`Loaded ${this.memoryCache.size} patterns from file cache`);
      } catch (err: unknown) {
        // File doesn't exist yet or parse error - that's fine
        // @ts-ignore - NodeJS.ErrnoException is only available in Node.js
        const error = err as {code?: string; message?: string};
        if (error.code !== 'ENOENT') {
          logger.debug('Failed to load cache file:', error.message);
        } else {
          logger.debug('No existing cache file found');
        }
      } finally {
        this.fileLoaded = true;
      }
    })();

    return this.fileLoadPromise;
  }

  /**
   * Save cached patterns to file (Node.js only)
   */
  private async saveToFile(): Promise<void> {
    if (!isNodeEnvironment) {
      return;
    }

    try {
      // @ts-ignore - fs/promises is only available in Node.js
      const fs = await import('fs/promises');
      const patterns = Array.from(this.memoryCache.values());
      await fs.writeFile(CACHE_FILE_PATH, JSON.stringify(patterns, null, 2));
      logger.debug(`Saved ${patterns.length} patterns to file cache`);
    } catch (err) {
      logger.error('Failed to save cache file:', err);
    }
  }

  /**
   * Generate a UUID for pattern IDs
   */
  private generateUUID(): string {
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
   * Normalize domain (remove protocol, www, path)
   */
  private normalizeDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      let hostname = urlObj.hostname;
      // Remove www prefix
      hostname = hostname.replace(/^www\./, '');
      return hostname.toLowerCase();
    } catch {
      // If URL parsing fails, do basic normalization
      let normalized = url.replace(/^https?:\/\//, '');
      normalized = normalized.replace(/^www\./, '');
      normalized = normalized.split('/')[0];
      return normalized.toLowerCase();
    }
  }

  /**
   * Extract path pattern from URL (first path segment or root)
   */
  private extractPathPattern(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathSegments = urlObj.pathname.split('/').filter(Boolean);
      if (pathSegments.length === 0) {
        return '/';
      }
      return '/' + pathSegments[0];
    } catch {
      return '/';
    }
  }

  /**
   * Generate cache key from site, path pattern, and semantic intent
   */
  generateCacheKey(
    url: string,
    semanticIntent: string,
    pathPatternOverride?: string
  ): ActionCacheKey {
    const site = this.normalizeDomain(url);
    const pathPattern = pathPatternOverride || this.extractPathPattern(url);
    return `${site}${pathPattern}:${semanticIntent}`;
  }

  /**
   * Get a cached pattern by cache key
   */
  async get(cacheKey: ActionCacheKey): Promise<CachedActionPattern | null> {
    // In Node.js, load from file first
    if (isNodeEnvironment) {
      await this.loadFromFile();
      const cached = this.memoryCache.get(cacheKey);
      if (cached && !this.isExpired(cached) && !this.isDegraded(cached)) {
        return cached;
      }
      return null;
    }

    // Check memory cache first
    const memCached = this.memoryCache.get(cacheKey);
    if (memCached && !this.isExpired(memCached) && !this.isDegraded(memCached)) {
      return memCached;
    }

    const db = await this.ensureDatabase();
    if (!db) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('cacheKey');
      const request = index.get(cacheKey);

      request.onsuccess = () => {
        const pattern = request.result as CachedActionPattern | undefined;

        if (!pattern) {
          resolve(null);
          return;
        }

        // Check if pattern is expired
        if (this.isExpired(pattern)) {
          logger.info(`Pattern for ${cacheKey} is expired, returning null`);
          resolve(null);
          return;
        }

        // Check if pattern has too many failures
        if (this.isDegraded(pattern)) {
          logger.info(`Pattern for ${cacheKey} has degraded (high failure rate), returning null`);
          resolve(null);
          return;
        }

        // Update memory cache
        this.memoryCache.set(cacheKey, pattern);
        resolve(pattern);
      };

      request.onerror = () => {
        logger.error('Failed to get pattern:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Find patterns for a site
   */
  async findBySite(site: string): Promise<CachedActionPattern[]> {
    const normalizedSite = this.normalizeDomain(site);

    // In Node.js, load from file first
    if (isNodeEnvironment) {
      await this.loadFromFile();
      return Array.from(this.memoryCache.values()).filter(
        p => p.site === normalizedSite && !this.isExpired(p) && !this.isDegraded(p)
      );
    }

    const db = await this.ensureDatabase();
    if (!db) {
      return Array.from(this.memoryCache.values()).filter(
        p => p.site === normalizedSite
      );
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('site');
      const request = index.getAll(normalizedSite);

      request.onsuccess = () => {
        const patterns = (request.result as CachedActionPattern[]).filter(
          p => !this.isExpired(p) && !this.isDegraded(p)
        );
        resolve(patterns);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Save a new cached pattern
   */
  async save(
    url: string,
    semanticIntent: string,
    xpath: string,
    attributes: ElementAttributes,
    cssSelector?: string,
    pathPatternOverride?: string
  ): Promise<CachedActionPattern> {
    const site = this.normalizeDomain(url);
    const pathPattern = pathPatternOverride || this.extractPathPattern(url);
    const cacheKey = this.generateCacheKey(url, semanticIntent, pathPatternOverride);
    const now = new Date().toISOString();

    const pattern: CachedActionPattern = {
      id: this.generateUUID(),
      cacheKey,
      site,
      pathPattern,
      semanticIntent,
      xpath,
      cssSelector,
      attributes,
      createdAt: now,
      lastUsedAt: now,
      successCount: 1, // Start with 1 since we're saving after a success
      failureCount: 0,
      schemaVersion: ACTION_CACHE_SCHEMA_VERSION,
    };

    // In Node.js, use file-based persistence
    if (isNodeEnvironment) {
      await this.loadFromFile(); // Ensure existing cache is loaded
      this.memoryCache.set(cacheKey, pattern);
      await this.saveToFile();
      logger.info(`Saved pattern to file cache for ${cacheKey}`);
      return pattern;
    }

    const db = await this.ensureDatabase();
    if (!db) {
      this.memoryCache.set(cacheKey, pattern);
      return pattern;
    }

    // Delete existing pattern for this cache key (upsert)
    await this.deleteByCacheKey(cacheKey);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(pattern);

      request.onsuccess = () => {
        logger.info(`Saved pattern for ${cacheKey}`);
        this.memoryCache.set(cacheKey, pattern);
        resolve(pattern);
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
  async update(id: string, updates: Partial<CachedActionPattern>): Promise<CachedActionPattern | null> {
    // In Node.js, use file-based persistence
    if (isNodeEnvironment) {
      await this.loadFromFile(); // Ensure cache is loaded
      const entries = Array.from(this.memoryCache.entries());
      for (const [key, pattern] of entries) {
        if (pattern.id === id) {
          const updated = { ...pattern, ...updates, lastUsedAt: new Date().toISOString() };
          this.memoryCache.set(key, updated);
          await this.saveToFile();
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
        const pattern = getRequest.result as CachedActionPattern | undefined;
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
          this.memoryCache.set(pattern.cacheKey, updatedPattern);
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
   * Record a successful action using cached pattern
   */
  async recordSuccess(cacheKey: ActionCacheKey): Promise<void> {
    const pattern = await this.get(cacheKey);
    if (pattern) {
      await this.update(pattern.id, {
        successCount: pattern.successCount + 1,
      });
      logger.debug(`Recorded success for ${cacheKey}, total: ${pattern.successCount + 1}`);
    }
  }

  /**
   * Record a failed action using cached pattern
   */
  async recordFailure(cacheKey: ActionCacheKey): Promise<void> {
    const pattern = await this.get(cacheKey);
    if (pattern) {
      await this.update(pattern.id, {
        failureCount: pattern.failureCount + 1,
      });
      logger.debug(`Recorded failure for ${cacheKey}, total: ${pattern.failureCount + 1}`);
    }
  }

  /**
   * Delete pattern by cache key
   */
  private async deleteByCacheKey(cacheKey: ActionCacheKey): Promise<void> {
    this.memoryCache.delete(cacheKey);

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
      const index = store.index('cacheKey');
      const request = index.getKey(cacheKey);

      request.onsuccess = () => {
        const key = request.result;
        if (key) {
          const deleteRequest = store.delete(key);
          deleteRequest.onsuccess = () => {
            logger.debug(`Deleted pattern by cacheKey: ${cacheKey}`);
            resolve();
          };
          deleteRequest.onerror = () => reject(deleteRequest.error);
        } else {
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all cached patterns
   */
  async getAll(): Promise<CachedActionPattern[]> {
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
        resolve(request.result as CachedActionPattern[]);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Clear all cached patterns
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();

    if (isNodeEnvironment) {
      // Delete the cache file
      try {
        // @ts-ignore - fs/promises is only available in Node.js
        const fs = await import('fs/promises');
        await fs.unlink(CACHE_FILE_PATH);
        logger.info('Deleted action pattern cache file');
      } catch (err: unknown) {
        // @ts-ignore - NodeJS.ErrnoException is only available in Node.js
        const error = err as {code?: string; message?: string};
        if (error.code !== 'ENOENT') {
          logger.debug('Failed to delete cache file:', error.message);
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
      const request = store.clear();

      request.onsuccess = () => {
        logger.info('Cleared action pattern cache');
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Check if pattern is expired
   */
  private isExpired(pattern: CachedActionPattern): boolean {
    const createdAt = new Date(pattern.createdAt).getTime();
    const now = Date.now();
    return now - createdAt > ACTION_CACHE_EXPIRY_MS;
  }

  /**
   * Check if pattern has degraded (high failure rate)
   */
  private isDegraded(pattern: CachedActionPattern): boolean {
    const totalUses = pattern.successCount + pattern.failureCount;
    if (totalUses < 5) {
      // Not enough data to determine
      return false;
    }
    const failureRate = pattern.failureCount / totalUses;
    return failureRate > ACTION_FAILURE_RATE_THRESHOLD;
  }
}
