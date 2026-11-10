// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from './Logger.js';

const logger = createLogger('AgentStorageManager');

const DATABASE_NAME = 'agent_studio_db';
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = 'customAgents';
const INDEX_NAME = 'name';

/**
 * Schema property definition for agent input
 */
export interface SchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  items?: { type: string };
  properties?: Record<string, SchemaProperty>;
}

/**
 * UI configuration for displaying an agent
 */
export interface AgentUIConfig {
  displayName: string;
  avatar: string;
  color: string;
  backgroundColor: string;
}

/**
 * Stored agent configuration in IndexedDB
 */
export interface StoredAgentConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  systemPrompt: string;
  tools: string[];
  maxIterations: number;
  temperature: number;
  modelName?: string;
  schema: {
    type: string;
    properties: Record<string, SchemaProperty>;
    required?: string[];
  };
  ui: AgentUIConfig;
  isBuiltIn: false;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input for creating a new agent (without auto-generated fields)
 */
export type CreateAgentInput = Omit<StoredAgentConfig, 'id' | 'createdAt' | 'updatedAt' | 'isBuiltIn'>;

/**
 * Input for updating an existing agent
 */
export type UpdateAgentInput = Partial<Omit<StoredAgentConfig, 'id' | 'createdAt' | 'isBuiltIn'>>;

interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Manages IndexedDB-backed storage for custom agent configurations.
 * Follows singleton pattern for consistent state across the application.
 */
export class AgentStorageManager {
  private static instance: AgentStorageManager | null = null;

  private db: IDBDatabase | null = null;
  private dbInitializationPromise: Promise<IDBDatabase> | null = null;

  private constructor() {
    logger.info('Initialized AgentStorageManager');
  }

  static getInstance(): AgentStorageManager {
    if (!AgentStorageManager.instance) {
      AgentStorageManager.instance = new AgentStorageManager();
    }
    return AgentStorageManager.instance;
  }

  /**
   * Create a new custom agent
   */
  async createAgent(input: CreateAgentInput): Promise<StoredAgentConfig> {
    const validation = this.validateAgentConfig(input);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid agent configuration');
    }

    const db = await this.ensureDatabase();

    // Check for name conflicts
    if (await this.agentNameExists(input.name)) {
      throw new Error(`Agent with name "${input.name}" already exists.`);
    }

    const now = new Date().toISOString();
    const agent: StoredAgentConfig = {
      ...input,
      id: this.generateUUID(),
      isBuiltIn: false,
      createdAt: now,
      updatedAt: now,
    };

    const transaction = db.transaction(OBJECT_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(OBJECT_STORE_NAME);

    await this.requestToPromise(store.add(agent));
    await this.transactionComplete(transaction);

    logger.info('Created custom agent', { name: agent.name, id: agent.id });
    return agent;
  }

  /**
   * Get an agent by ID
   */
  async getAgent(id: string): Promise<StoredAgentConfig | null> {
    const db = await this.ensureDatabase();
    const transaction = db.transaction(OBJECT_STORE_NAME, 'readonly');
    const store = transaction.objectStore(OBJECT_STORE_NAME);

    const agent = await this.requestToPromise<StoredAgentConfig | undefined>(store.get(id));
    await this.transactionComplete(transaction);

    return agent || null;
  }

  /**
   * Get an agent by name
   */
  async getAgentByName(name: string): Promise<StoredAgentConfig | null> {
    const db = await this.ensureDatabase();
    const transaction = db.transaction(OBJECT_STORE_NAME, 'readonly');
    const store = transaction.objectStore(OBJECT_STORE_NAME);
    const index = store.index(INDEX_NAME);

    const agent = await this.requestToPromise<StoredAgentConfig | undefined>(index.get(name));
    await this.transactionComplete(transaction);

    return agent || null;
  }

  /**
   * Get all custom agents
   */
  async getAllAgents(): Promise<StoredAgentConfig[]> {
    const db = await this.ensureDatabase();
    const transaction = db.transaction(OBJECT_STORE_NAME, 'readonly');
    const store = transaction.objectStore(OBJECT_STORE_NAME);

    const agents = await this.requestToPromise<StoredAgentConfig[]>(store.getAll());
    await this.transactionComplete(transaction);

    // Sort by creation date (newest first)
    return (agents || []).sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Update an existing agent
   */
  async updateAgent(id: string, updates: UpdateAgentInput): Promise<StoredAgentConfig> {
    const db = await this.ensureDatabase();
    const existing = await this.getAgent(id);

    if (!existing) {
      throw new Error(`Agent with ID "${id}" not found.`);
    }

    // If name is being changed, check for conflicts
    if (updates.name && updates.name !== existing.name) {
      if (await this.agentNameExists(updates.name)) {
        throw new Error(`Agent with name "${updates.name}" already exists.`);
      }
    }

    const updated: StoredAgentConfig = {
      ...existing,
      ...updates,
      id: existing.id, // Ensure ID cannot be changed
      isBuiltIn: false, // Ensure isBuiltIn cannot be changed
      createdAt: existing.createdAt, // Ensure createdAt cannot be changed
      updatedAt: new Date().toISOString(),
    };

    const validation = this.validateAgentConfig(updated);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid agent configuration');
    }

    const transaction = db.transaction(OBJECT_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(OBJECT_STORE_NAME);

    await this.requestToPromise(store.put(updated));
    await this.transactionComplete(transaction);

    logger.info('Updated custom agent', { name: updated.name, id: updated.id });
    return updated;
  }

  /**
   * Delete an agent by ID
   */
  async deleteAgent(id: string): Promise<void> {
    const db = await this.ensureDatabase();
    const existing = await this.getAgent(id);

    if (!existing) {
      throw new Error(`Agent with ID "${id}" not found.`);
    }

    const transaction = db.transaction(OBJECT_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(OBJECT_STORE_NAME);

    await this.requestToPromise(store.delete(id));
    await this.transactionComplete(transaction);

    logger.info('Deleted custom agent', { name: existing.name, id });
  }

  /**
   * Check if an agent name already exists
   */
  async agentNameExists(name: string): Promise<boolean> {
    const agent = await this.getAgentByName(name);
    return agent !== null;
  }

  /**
   * Export all agents as JSON array
   */
  async exportAgents(): Promise<StoredAgentConfig[]> {
    return this.getAllAgents();
  }

  /**
   * Import agents from JSON array
   * Skips agents with conflicting names
   */
  async importAgents(configs: StoredAgentConfig[]): Promise<{ imported: number; skipped: string[] }> {
    const skipped: string[] = [];
    let imported = 0;

    for (const config of configs) {
      try {
        // Create a new agent with the imported config (generates new ID)
        const input: CreateAgentInput = {
          name: config.name,
          description: config.description,
          version: config.version,
          systemPrompt: config.systemPrompt,
          tools: config.tools,
          maxIterations: config.maxIterations,
          temperature: config.temperature,
          modelName: config.modelName,
          schema: config.schema,
          ui: config.ui,
        };

        await this.createAgent(input);
        imported++;
      } catch (error) {
        logger.warn(`Skipped importing agent "${config.name}":`, error);
        skipped.push(config.name);
      }
    }

    logger.info('Import complete', { imported, skipped: skipped.length });
    return { imported, skipped };
  }

  /**
   * Validate agent configuration
   */
  private validateAgentConfig(config: Partial<StoredAgentConfig>): ValidationResult {
    // Name validation
    if (!config.name || !config.name.trim()) {
      return { valid: false, error: 'Agent name cannot be empty.' };
    }

    // Name format: lowercase, hyphens, underscores only
    if (!/^[a-z][a-z0-9_-]*$/.test(config.name)) {
      return {
        valid: false,
        error: 'Agent name must start with a lowercase letter and contain only lowercase letters, numbers, hyphens, and underscores.'
      };
    }

    if (config.name.length > 64) {
      return { valid: false, error: 'Agent name must be 64 characters or fewer.' };
    }

    // System prompt validation
    if (!config.systemPrompt || !config.systemPrompt.trim()) {
      return { valid: false, error: 'System prompt cannot be empty.' };
    }

    // Tools validation
    if (!config.tools || config.tools.length === 0) {
      return { valid: false, error: 'At least one tool must be selected.' };
    }

    // Max iterations validation
    if (config.maxIterations !== undefined) {
      if (!Number.isInteger(config.maxIterations) || config.maxIterations < 1 || config.maxIterations > 100) {
        return { valid: false, error: 'Max iterations must be an integer between 1 and 100.' };
      }
    }

    // Temperature validation
    if (config.temperature !== undefined) {
      if (typeof config.temperature !== 'number' || config.temperature < 0 || config.temperature > 2) {
        return { valid: false, error: 'Temperature must be a number between 0 and 2.' };
      }
    }

    // Schema validation
    if (!config.schema || config.schema.type !== 'object') {
      return { valid: false, error: 'Schema must have type "object".' };
    }

    return { valid: true };
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
        logger.info('Initializing agent storage database');

        if (!db.objectStoreNames.contains(OBJECT_STORE_NAME)) {
          const store = db.createObjectStore(OBJECT_STORE_NAME, { keyPath: 'id' });
          store.createIndex(INDEX_NAME, 'name', { unique: true });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error || new Error('Failed to open IndexedDB'));
      };

      request.onblocked = () => {
        logger.warn('Agent storage database open request was blocked.');
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

  private generateUUID(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
    return template.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}
