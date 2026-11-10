// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * MiniApp Types - Core interfaces for the Mini Apps system
 *
 * This system enables multiple self-contained UI applications to be rendered
 * as full-screen iframes with full AI read/write control over their state.
 */

// ============================================================================
// SPA Content Types
// ============================================================================

/**
 * The HTML, CSS, and JS content that makes up a mini app's UI
 */
export interface MiniAppSPA {
  html: string;
  css: string;
  js: string;
}

// ============================================================================
// Schema Types (for AI tool integration)
// ============================================================================

/**
 * Schema for an action that AI agents can invoke on a mini app
 */
export interface MiniAppActionSchema {
  /** Action name (used in ExecuteMiniAppActionTool) */
  name: string;
  /** Description for AI agents */
  description: string;
  /** JSON Schema for action arguments */
  schema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Schema describing the state structure a mini app exposes
 */
export interface MiniAppStateSchema {
  type: string;
  properties: Record<string, {
    type: string;
    description: string;
    items?: unknown;
    properties?: Record<string, unknown>;
  }>;
}

// ============================================================================
// State Types
// ============================================================================

/**
 * Generic mini app state - a key-value store
 */
export interface MiniAppState {
  [key: string]: unknown;
}

/**
 * Snapshot of mini app state at a point in time
 */
export interface MiniAppStateSnapshot {
  appId: string;
  timestamp: Date;
  state: MiniAppState;
}

// ============================================================================
// Action Types (Communication Protocol)
// ============================================================================

/**
 * Base action from SPA to DevTools
 */
export interface SPAToDevToolsAction {
  type: string;
  payload?: unknown;
}

/**
 * Base action from DevTools to SPA
 */
export interface DevToolsToSPAAction {
  action: string;
  payload?: unknown;
}

/**
 * Standard lifecycle actions all mini apps must support (SPA → DevTools)
 */
export type StandardSPAAction =
  | { type: 'ready' }
  | { type: 'close' }
  | { type: 'state-changed'; state: MiniAppState }
  | { type: 'error'; error: string };

/**
 * Standard actions all mini apps receive (DevTools → SPA)
 */
export type StandardDevToolsAction =
  | { action: 'init'; payload: unknown }
  | { action: 'get-state' }
  | { action: 'set-state'; payload: MiniAppState }
  | { action: 'update-state'; payload: Partial<MiniAppState> }
  | { action: 'execute'; payload: { actionName: string; args: unknown } };

// ============================================================================
// Bridge Interface
// ============================================================================

/**
 * Handles bidirectional communication between DevTools and a mini app SPA
 */
export interface MiniAppBridge {
  /** Install the bridge for a specific webapp instance */
  install(webappId: string): Promise<void>;

  /** Uninstall the bridge and clean up resources */
  uninstall(): Promise<void>;

  /** Send an action to the SPA */
  sendToSPA(action: DevToolsToSPAAction): Promise<void>;

  /** Register a handler for actions from the SPA */
  onAction(handler: (action: SPAToDevToolsAction) => void | Promise<void>): void;

  /** Get the current state from the SPA */
  getState(): Promise<MiniAppState>;

  /** Check if the bridge is installed */
  readonly installed: boolean;

  /** The webapp ID this bridge is connected to */
  readonly webappId: string | null;
}

// ============================================================================
// Controller Interface
// ============================================================================

/**
 * Handles business logic for a mini app
 */
export interface MiniAppController {
  /** Initialize the controller with a bridge */
  initialize(bridge: MiniAppBridge): Promise<void>;

  /** Get the current state */
  getState(): Promise<MiniAppState>;

  /** Set the entire state */
  setState(state: MiniAppState): Promise<void>;

  /** Update state partially */
  updateState(updates: Partial<MiniAppState>): Promise<void>;

  /** Execute a named action with arguments */
  executeAction(actionName: string, args: unknown): Promise<unknown>;

  /** Clean up resources */
  cleanup(): Promise<void>;

  /** Register a callback for when the app closes */
  onClose(callback: () => void | Promise<void>): void;
}

// ============================================================================
// MiniApp Interface (Main Contract)
// ============================================================================

/**
 * Core interface that all mini apps must implement
 */
export interface MiniApp {
  /** Unique identifier for this app type */
  id: string;

  /** Human-readable display name */
  name: string;

  /** Description for AI agents to understand what this app does */
  description: string;

  /** Icon for the app (emoji or icon class) */
  icon: string;

  /** Get the SPA content (HTML, CSS, JS) */
  getSPA(): MiniAppSPA;

  /** Get the actions this app supports (for AI tooling) */
  getSupportedActions(): MiniAppActionSchema[];

  /** Get the state schema this app exposes (for AI reading) */
  getStateSchema(): MiniAppStateSchema;

  /** Create a controller instance for this app */
  createController(): MiniAppController;
}

// ============================================================================
// Instance Types (for Registry)
// ============================================================================

/**
 * A running instance of a mini app
 */
export interface MiniAppInstance {
  /** The app definition */
  app: MiniApp;

  /** The controller handling business logic */
  controller: MiniAppController;

  /** The bridge handling communication */
  bridge: MiniAppBridge;

  /** The webapp ID (iframe ID) */
  webappId: string;

  /** When this instance was launched */
  launchedAt: Date;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Events emitted by the mini app system
 */
export type MiniAppEventType =
  | 'app_launched'
  | 'app_closed'
  | 'state_changed'
  | 'action_received'
  | 'action_executed'
  | 'error';

/**
 * Event payload for mini app events
 */
export interface MiniAppEvent {
  type: MiniAppEventType;
  appId: string;
  timestamp: Date;
  data?: unknown;
}

// ============================================================================
// Storage Types
// ============================================================================

/**
 * Storage entry for mini app data
 */
export interface MiniAppStorageEntry {
  appId: string;
  key: string;
  value: unknown;
  updatedAt: string;
}
