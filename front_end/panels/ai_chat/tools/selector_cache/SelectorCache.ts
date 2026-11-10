// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../../core/Logger.js';
import type {
  CachedSelector,
  CacheKeyIdentifier,
} from './types.js';
import { SELECTOR_SCHEMA_VERSION, SELECTOR_EXPIRY_MS, FAILURE_RATE_THRESHOLD } from './types.js';

const logger = createLogger('SelectorCache');

// Detect if we're in a Node.js environment (eval runner)
const isNodeEnvironment = typeof window === 'undefined' || typeof indexedDB === 'undefined';

/** Database name for selector cache */
const DB_NAME = 'selector_cache_db';
/** Database version */
const DB_VERSION = 1;
/** Object store name */
const STORE_NAME = 'selectors';

/**
 * Manages cached JavaScript selectors for schema-based extraction.
 * Uses IndexedDB for browser persistence, in-memory Map for Node.js.
 * Singleton pattern for connection reuse.
 */
export class SelectorCache {
  private static instance: SelectorCache | null = null;
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  // In-memory fallback for Node.js (eval runner)
  private memoryCache: Map<CacheKeyIdentifier, CachedSelector> = new Map();

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): SelectorCache {
    if (!SelectorCache.instance) {
      SelectorCache.instance = new SelectorCache();
    }
    return SelectorCache.instance;
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
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('schemaHash', 'schemaHash', { unique: false });
          logger.debug('Created object store and indexes');
        }
      };
    });

    return this.dbPromise;
  }

  /**
   * Generate a UUID for selector IDs
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
   * Generate cache key from domain, path pattern, and schema
   */
  async generateCacheKey(
    domain: string,
    pathPattern: string,
    schema: object,
    userOverride?: string
  ): Promise<CacheKeyIdentifier> {
    if (userOverride) {
      return userOverride;
    }

    const normalizedDomain = this.normalizeDomain(domain);
    const schemaHash = await this.hashSchema(schema);

    return `${normalizedDomain}/${pathPattern}:${schemaHash}`;
  }

  /**
   * Hash schema to 8-character hex string
   */
  async hashSchema(schema: object): Promise<string> {
    const schemaString = JSON.stringify(schema);

    // Use SubtleCrypto if available (browser)
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(schemaString);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 8);
      } catch {
        // Fall through to simple hash
      }
    }

    // Fallback: simple hash
    let hash = 0;
    for (let i = 0; i < schemaString.length; i++) {
      const char = schemaString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0').substring(0, 8);
  }

  /**
   * Get a cached selector by cache key
   */
  async get(cacheKey: CacheKeyIdentifier): Promise<CachedSelector | null> {
    // In-memory fallback for Node.js
    if (isNodeEnvironment) {
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
        const selector = request.result as CachedSelector | undefined;

        if (!selector) {
          resolve(null);
          return;
        }

        // Check if selector is expired
        if (this.isExpired(selector)) {
          logger.info(`Selector for ${cacheKey} is expired, returning null`);
          resolve(null);
          return;
        }

        // Check if selector has too many failures
        if (this.isDegraded(selector)) {
          logger.info(`Selector for ${cacheKey} has degraded (high failure rate), returning null`);
          resolve(null);
          return;
        }

        // Update memory cache
        this.memoryCache.set(cacheKey, selector);
        resolve(selector);
      };

      request.onerror = () => {
        logger.error('Failed to get selector:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Save a new cached selector
   */
  async save(
    cacheKey: CacheKeyIdentifier,
    selectorScript: string,
    schemaHash: string
  ): Promise<CachedSelector> {
    const now = new Date().toISOString();

    const selector: CachedSelector = {
      id: this.generateUUID(),
      cacheKey,
      selectorScript,
      schemaHash,
      createdAt: now,
      lastUsedAt: now,
      successCount: 0,
      failureCount: 0,
      schemaVersion: SELECTOR_SCHEMA_VERSION,
    };

    // In-memory fallback for Node.js
    if (isNodeEnvironment) {
      this.memoryCache.set(cacheKey, selector);
      logger.debug(`Saved selector to memory cache for ${cacheKey}`);
      return selector;
    }

    const db = await this.ensureDatabase();
    if (!db) {
      this.memoryCache.set(cacheKey, selector);
      return selector;
    }

    // Delete existing selector for this cache key (upsert)
    await this.deleteByCacheKey(cacheKey);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(selector);

      request.onsuccess = () => {
        logger.info(`Saved selector for ${cacheKey}`);
        // Also update memory cache
        this.memoryCache.set(cacheKey, selector);
        resolve(selector);
      };

      request.onerror = () => {
        logger.error('Failed to save selector:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Update an existing selector
   */
  async update(id: string, updates: Partial<CachedSelector>): Promise<CachedSelector | null> {
    // In-memory fallback
    if (isNodeEnvironment) {
      for (const [key, selector] of this.memoryCache) {
        if (selector.id === id) {
          const updated = { ...selector, ...updates, lastUsedAt: new Date().toISOString() };
          this.memoryCache.set(key, updated);
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
        const selector = getRequest.result as CachedSelector | undefined;
        if (!selector) {
          resolve(null);
          return;
        }

        const updatedSelector = {
          ...selector,
          ...updates,
          lastUsedAt: new Date().toISOString(),
        };

        const putRequest = store.put(updatedSelector);
        putRequest.onsuccess = () => {
          // Update memory cache
          this.memoryCache.set(selector.cacheKey, updatedSelector);
          resolve(updatedSelector);
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
  async recordSuccess(cacheKey: CacheKeyIdentifier): Promise<void> {
    const selector = await this.get(cacheKey);
    if (selector) {
      await this.update(selector.id, {
        successCount: selector.successCount + 1,
      });
    }
  }

  /**
   * Record a failed extraction
   */
  async recordFailure(cacheKey: CacheKeyIdentifier): Promise<void> {
    const selector = await this.get(cacheKey);
    if (selector) {
      await this.update(selector.id, {
        failureCount: selector.failureCount + 1,
      });
    }
  }

  /**
   * Delete selector by ID
   */
  async delete(id: string): Promise<void> {
    // In-memory fallback
    if (isNodeEnvironment) {
      for (const [key, selector] of this.memoryCache) {
        if (selector.id === id) {
          this.memoryCache.delete(key);
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
        // Also invalidate memory cache
        for (const [key, selector] of this.memoryCache) {
          if (selector.id === id) {
            this.memoryCache.delete(key);
            break;
          }
        }
        logger.info(`Deleted selector ${id}`);
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Delete selector by cache key (bypasses expiry/degradation checks)
   */
  private async deleteByCacheKey(cacheKey: CacheKeyIdentifier): Promise<void> {
    // Delete from memory cache directly
    this.memoryCache.delete(cacheKey);

    if (isNodeEnvironment) {
      return;
    }

    // Delete from IndexedDB by cache key (not using get() to avoid expiry/degradation checks)
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
            logger.debug(`Deleted selector by cacheKey: ${cacheKey}`);
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
   * Get all cached selectors
   */
  async getAll(): Promise<CachedSelector[]> {
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
        resolve(request.result as CachedSelector[]);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Clear all cached selectors
   */
  async clear(): Promise<void> {
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
        logger.info('Cleared selector cache');
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Normalize domain (remove protocol, www, path)
   */
  private normalizeDomain(domain: string): string {
    // Remove protocol
    let normalized = domain.replace(/^https?:\/\//, '');
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
   * Check if selector is expired
   */
  private isExpired(selector: CachedSelector): boolean {
    const createdAt = new Date(selector.createdAt).getTime();
    const now = Date.now();
    return now - createdAt > SELECTOR_EXPIRY_MS;
  }

  /**
   * Check if selector has degraded (high failure rate)
   */
  private isDegraded(selector: CachedSelector): boolean {
    const totalUses = selector.successCount + selector.failureCount;
    if (totalUses < 5) {
      // Not enough data to determine
      return false;
    }
    const failureRate = selector.failureCount / totalUses;
    return failureRate > FAILURE_RATE_THRESHOLD;
  }
}
