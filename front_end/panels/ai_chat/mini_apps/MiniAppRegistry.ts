// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../core/Logger.js';
import type {
  MiniApp,
  MiniAppInstance,
  MiniAppBridge,
  MiniAppController,
} from './types/MiniAppTypes.js';
import { GenericMiniAppBridge } from './GenericMiniAppBridge.js';
import { MiniAppEventBus } from './MiniAppEventBus.js';
import { RenderWebAppTool } from '../tools/RenderWebAppTool.js';
import { RemoveWebAppTool } from '../tools/RemoveWebAppTool.js';

const logger = createLogger('MiniAppRegistry');

/**
 * MiniAppRegistry - Central registry for mini app lifecycle management
 *
 * Responsibilities:
 * - Register mini app definitions
 * - Launch mini apps (single instance per app type)
 * - Track running instances
 * - Close and cleanup mini apps
 */
export class MiniAppRegistry {
  private static apps = new Map<string, MiniApp>();
  private static instances = new Map<string, MiniAppInstance>();

  /**
   * Register a mini app definition
   */
  static register(app: MiniApp): void {
    if (this.apps.has(app.id)) {
      logger.warn(`Mini app "${app.id}" is already registered, replacing...`);
    }
    this.apps.set(app.id, app);
    logger.info(`Registered mini app: ${app.id}`);
  }

  /**
   * Unregister a mini app definition
   */
  static unregister(appId: string): void {
    if (this.instances.has(appId)) {
      logger.warn(`Cannot unregister "${appId}" while it is running. Close it first.`);
      return;
    }
    this.apps.delete(appId);
    logger.info(`Unregistered mini app: ${appId}`);
  }

  /**
   * Get a registered mini app by ID
   */
  static getApp(appId: string): MiniApp | undefined {
    return this.apps.get(appId);
  }

  /**
   * Get all registered mini apps
   */
  static getAllApps(): MiniApp[] {
    return Array.from(this.apps.values());
  }

  /**
   * Check if a mini app is currently running
   */
  static isRunning(appId: string): boolean {
    return this.instances.has(appId);
  }

  /**
   * Get a running instance by app ID
   */
  static getRunningInstance(appId: string): MiniAppInstance | undefined {
    return this.instances.get(appId);
  }

  /**
   * Get all running instances
   */
  static getAllRunningInstances(): MiniAppInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Launch a mini app
   *
   * If the app is already running, returns the existing instance.
   * Only one instance per app type is allowed.
   */
  static async launch(appId: string): Promise<MiniAppInstance> {
    // Check if already running (single instance per app)
    const existing = this.instances.get(appId);
    if (existing) {
      logger.info(`Mini app "${appId}" is already running, returning existing instance`);
      return existing;
    }

    // Get the app definition
    const app = this.apps.get(appId);
    if (!app) {
      throw new Error(`Mini app "${appId}" is not registered`);
    }

    logger.info(`Launching mini app: ${appId}`);

    try {
      // Get SPA content
      const spa = app.getSPA();

      // Render the webapp using RenderWebAppTool
      const renderTool = new RenderWebAppTool();
      const renderResult = await renderTool.execute({
        html: spa.html,
        css: spa.css,
        js: this.wrapSPAJavaScript(appId, spa.js),
        reasoning: `Launching mini app: ${app.name}`,
      });

      if ('error' in renderResult) {
        throw new Error(`Failed to render mini app: ${renderResult.error}`);
      }

      const webappId = renderResult.webappId;

      // Create the bridge
      const bridge: MiniAppBridge = new GenericMiniAppBridge(appId);
      await bridge.install(webappId);

      // Create the controller
      const controller: MiniAppController = app.createController();

      // Create the instance
      const instance: MiniAppInstance = {
        app,
        controller,
        bridge,
        webappId,
        launchedAt: new Date(),
      };

      // Store the instance
      this.instances.set(appId, instance);

      // Set up close handler
      controller.onClose(async () => {
        await this.close(appId);
      });

      // Initialize the controller with the bridge
      await controller.initialize(bridge);

      // Emit launch event
      MiniAppEventBus.getInstance().emit({
        type: 'app_launched',
        appId,
        timestamp: new Date(),
        data: { webappId },
      });

      logger.info(`Successfully launched mini app: ${appId}`, { webappId });
      return instance;

    } catch (error) {
      logger.error(`Failed to launch mini app "${appId}":`, error);
      throw error;
    }
  }

  /**
   * Close a running mini app
   */
  static async close(appId: string): Promise<void> {
    const instance = this.instances.get(appId);
    if (!instance) {
      logger.warn(`Mini app "${appId}" is not running`);
      return;
    }

    logger.info(`Closing mini app: ${appId}`);

    try {
      // Clean up controller
      await instance.controller.cleanup();

      // Uninstall bridge
      await instance.bridge.uninstall();

      // Remove the webapp
      const removeTool = new RemoveWebAppTool();
      await removeTool.execute({ webappId: instance.webappId, reasoning: `Closing mini app: ${appId}` });

      // Remove from instances
      this.instances.delete(appId);

      // Emit close event
      MiniAppEventBus.getInstance().emit({
        type: 'app_closed',
        appId,
        timestamp: new Date(),
      });

      logger.info(`Successfully closed mini app: ${appId}`);

    } catch (error) {
      logger.error(`Error closing mini app "${appId}":`, error);
      // Still remove from instances to avoid stuck state
      this.instances.delete(appId);
      throw error;
    }
  }

  /**
   * Close all running mini apps
   */
  static async closeAll(): Promise<void> {
    const appIds = Array.from(this.instances.keys());
    logger.info(`Closing all mini apps: ${appIds.join(', ') || 'none running'}`);

    for (const appId of appIds) {
      try {
        await this.close(appId);
      } catch (error) {
        logger.error(`Error closing mini app "${appId}":`, error);
      }
    }
  }

  /**
   * Wrap SPA JavaScript with the standard mini app protocol
   *
   * This adds the window.miniApp interface that all SPAs must implement:
   * - window.miniApp.dispatch(action) - receive actions from DevTools
   * - window.miniApp.getState() - return current state to DevTools
   */
  private static wrapSPAJavaScript(appId: string, originalJs: string): string {
    const bindingName = `__miniAppBridge_${appId}`;

    const wrapper = `
// ============================================================================
// Mini App Protocol Wrapper (auto-injected)
// ============================================================================
(function() {
  // Internal state storage
  let __miniAppState = {};

  // Mini App interface (called by DevTools)
  window.miniApp = {
    // Dispatch an action from DevTools to the SPA
    dispatch: function(action) {
      if (typeof action === 'string') {
        try {
          action = JSON.parse(action);
        } catch (e) {
          console.error('[MiniApp] Failed to parse action:', e);
          return;
        }
      }

      console.log('[MiniApp] Received action:', action.action);

      // Handle standard actions
      switch (action.action) {
        case 'get-state':
          // State is returned via getState() method
          break;

        case 'set-state':
          __miniAppState = action.payload || {};
          if (typeof window.onMiniAppStateChange === 'function') {
            window.onMiniAppStateChange(__miniAppState);
          }
          break;

        case 'update-state':
          __miniAppState = { ...__miniAppState, ...(action.payload || {}) };
          if (typeof window.onMiniAppStateChange === 'function') {
            window.onMiniAppStateChange(__miniAppState);
          }
          break;

        case 'execute':
          if (typeof window.onMiniAppAction === 'function') {
            const { actionName, args } = action.payload || {};
            window.onMiniAppAction(actionName, args);
          }
          break;

        default:
          // Forward to custom handler if defined
          if (typeof window.onMiniAppDispatch === 'function') {
            window.onMiniAppDispatch(action);
          }
      }
    },

    // Get current state (called by DevTools)
    getState: function() {
      // Allow SPA to provide custom state getter
      if (typeof window.getMiniAppState === 'function') {
        return window.getMiniAppState();
      }
      return __miniAppState;
    },

    // Update state from SPA code
    setState: function(newState) {
      __miniAppState = newState;
      // Notify DevTools of state change
      window.${bindingName}(JSON.stringify({
        type: 'state-changed',
        state: __miniAppState
      }));
    },

    // Update state partially from SPA code
    updateState: function(updates) {
      __miniAppState = { ...__miniAppState, ...updates };
      // Notify DevTools of state change
      window.${bindingName}(JSON.stringify({
        type: 'state-changed',
        state: __miniAppState
      }));
    },

    // Send action to DevTools
    sendAction: function(type, payload) {
      window.${bindingName}(JSON.stringify({ type, payload }));
    },

    // Close the mini app
    close: function() {
      window.${bindingName}(JSON.stringify({ type: 'close' }));
    }
  };

  // Signal that mini app is ready
  window.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
      window.${bindingName}(JSON.stringify({ type: 'ready' }));
    }, 100);
  });

  // If DOM is already loaded, signal ready immediately
  if (document.readyState !== 'loading') {
    setTimeout(function() {
      window.${bindingName}(JSON.stringify({ type: 'ready' }));
    }, 100);
  }
})();
// ============================================================================
// End Mini App Protocol Wrapper
// ============================================================================

`;

    return wrapper + '\n' + originalJs;
  }
}
