// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../core/Logger.js';
import type { MiniAppStorageEntry } from './types/MiniAppTypes.js';

const logger = createLogger('MiniAppStorageManager');

const DATABASE_NAME = 'mini_apps_storage_db';
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = 'miniAppData';

/**
 * MiniAppStorageManager - Unified IndexedDB storage for all mini apps
 *
 * Provides a scoped key-value store where each mini app's data is
 * automatically namespaced by its appId.
 *
 * Storage schema:
 * - Primary key: composite of (appId, key)
 * - Index on appId for efficient app-scoped queries
 */
export class MiniAppStorageManager {
  private static instance: MiniAppStorageManager | null = null;

  private db: IDBDatabase | null = null;
  private dbInitializationPromise: Promise<IDBDatabase> | null = null;

  private constructor() {
    logger.info('Initialized MiniAppStorageManager');
  }

  static getInstance(): MiniAppStorageManager {
    if (!MiniAppStorageManager.instance) {
      MiniAppStorageManager.instance = new MiniAppStorageManager();
    }
    return MiniAppStorageManager.instance;
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get a value for a specific app and key
   */
  async get(appId: string, key: string): Promise<unknown> {
    const db = await this.ensureDatabase();
    const transaction = db.transaction(OBJECT_STORE_NAME, 'readonly');
    const store = transaction.objectStore(OBJECT_STORE_NAME);

    const compositeKey = this.makeCompositeKey(appId, key);
    const entry = await this.requestToPromise<MiniAppStorageEntry | undefined>(store.get(compositeKey));
    await this.transactionComplete(transaction);

    return entry?.value;
  }

  /**
   * Set a value for a specific app and key
   */
  async set(appId: string, key: string, value: unknown): Promise<void> {
    const db = await this.ensureDatabase();
    const transaction = db.transaction(OBJECT_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(OBJECT_STORE_NAME);

    const entry: MiniAppStorageEntry = {
      appId,
      key,
      value,
      updatedAt: new Date().toISOString(),
    };

    const compositeKey = this.makeCompositeKey(appId, key);
    await this.requestToPromise(store.put({ ...entry, id: compositeKey }));
    await this.transactionComplete(transaction);

    logger.debug(`Set storage for "${appId}": ${key}`);
  }

  /**
   * Delete a value for a specific app and key
   */
  async delete(appId: string, key: string): Promise<void> {
    const db = await this.ensureDatabase();
    const transaction = db.transaction(OBJECT_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(OBJECT_STORE_NAME);

    const compositeKey = this.makeCompositeKey(appId, key);
    await this.requestToPromise(store.delete(compositeKey));
    await this.transactionComplete(transaction);

    logger.debug(`Deleted storage for "${appId}": ${key}`);
  }

  /**
   * Get all key-value pairs for a specific app
   */
  async getAll(appId: string): Promise<Record<string, unknown>> {
    const db = await this.ensureDatabase();
    const transaction = db.transaction(OBJECT_STORE_NAME, 'readonly');
    const store = transaction.objectStore(OBJECT_STORE_NAME);
    const index = store.index('appId');

    const entries = await this.requestToPromise<MiniAppStorageEntry[]>(index.getAll(appId));
    await this.transactionComplete(transaction);

    const result: Record<string, unknown> = {};
    for (const entry of entries || []) {
      result[entry.key] = entry.value;
    }

    return result;
  }

  /**
   * Clear all data for a specific app
   */
  async clear(appId: string): Promise<void> {
    const db = await this.ensureDatabase();
    const transaction = db.transaction(OBJECT_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(OBJECT_STORE_NAME);
    const index = store.index('appId');

    // Get all keys for this app
    const keysRequest = index.getAllKeys(appId);
    const keys = await this.requestToPromise<IDBValidKey[]>(keysRequest);

    // Delete each entry
    for (const key of keys || []) {
      await this.requestToPromise(store.delete(key));
    }

    await this.transactionComplete(transaction);
    logger.info(`Cleared all storage for "${appId}"`);
  }

  /**
   * Check if a key exists for a specific app
   */
  async has(appId: string, key: string): Promise<boolean> {
    const value = await this.get(appId, key);
    return value !== undefined;
  }

  /**
   * Get all keys for a specific app
   */
  async keys(appId: string): Promise<string[]> {
    const db = await this.ensureDatabase();
    const transaction = db.transaction(OBJECT_STORE_NAME, 'readonly');
    const store = transaction.objectStore(OBJECT_STORE_NAME);
    const index = store.index('appId');

    const entries = await this.requestToPromise<MiniAppStorageEntry[]>(index.getAll(appId));
    await this.transactionComplete(transaction);

    return (entries || []).map(e => e.key);
  }

  /**
   * Get the count of entries for a specific app
   */
  async count(appId: string): Promise<number> {
    const db = await this.ensureDatabase();
    const transaction = db.transaction(OBJECT_STORE_NAME, 'readonly');
    const store = transaction.objectStore(OBJECT_STORE_NAME);
    const index = store.index('appId');

    const count = await this.requestToPromise<number>(index.count(appId));
    await this.transactionComplete(transaction);

    return count;
  }

  // ============================================================================
  // Batch Operations
  // ============================================================================

  /**
   * Set multiple values at once for a specific app
   */
  async setMany(appId: string, entries: Record<string, unknown>): Promise<void> {
    const db = await this.ensureDatabase();
    const transaction = db.transaction(OBJECT_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(OBJECT_STORE_NAME);

    const now = new Date().toISOString();

    for (const [key, value] of Object.entries(entries)) {
      const entry: MiniAppStorageEntry = {
        appId,
        key,
        value,
        updatedAt: now,
      };
      const compositeKey = this.makeCompositeKey(appId, key);
      await this.requestToPromise(store.put({ ...entry, id: compositeKey }));
    }

    await this.transactionComplete(transaction);
    logger.debug(`Set ${Object.keys(entries).length} entries for "${appId}"`);
  }

  /**
   * Delete multiple keys at once for a specific app
   */
  async deleteMany(appId: string, keys: string[]): Promise<void> {
    const db = await this.ensureDatabase();
    const transaction = db.transaction(OBJECT_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(OBJECT_STORE_NAME);

    for (const key of keys) {
      const compositeKey = this.makeCompositeKey(appId, key);
      await this.requestToPromise(store.delete(compositeKey));
    }

    await this.transactionComplete(transaction);
    logger.debug(`Deleted ${keys.length} entries for "${appId}"`);
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private makeCompositeKey(appId: string, key: string): string {
    return `${appId}::${key}`;
  }

  private async ensureDatabase(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    if (!('indexedDB' in globalThis)) {
      throw new Error('IndexedDB is not supported in this environment.');
    }

    if (this.dbInitializationPromise) {
      this.db = await this.dbInitializationPromise;
      return this.db;
    }

    this.dbInitializationPromise = this.openDatabase();

    try {
      this.db = await this.dbInitializationPromise;
      return this.db;
    } catch (error) {
      this.dbInitializationPromise = null;
      logger.error('Failed to open IndexedDB database', { error });
      throw error;
    }
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        logger.info('Initializing mini apps storage database');

        if (!db.objectStoreNames.contains(OBJECT_STORE_NAME)) {
          const store = db.createObjectStore(OBJECT_STORE_NAME, { keyPath: 'id' });
          // Index for querying by appId
          store.createIndex('appId', 'appId', { unique: false });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error || new Error('Failed to open IndexedDB'));
      };

      request.onblocked = () => {
        logger.warn('Mini apps storage database open request was blocked.');
      };
    });
  }

  private requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  private transactionComplete(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    });
  }
}
