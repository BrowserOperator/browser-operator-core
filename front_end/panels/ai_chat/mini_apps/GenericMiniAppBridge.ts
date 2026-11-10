// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as SDK from '../../../core/sdk/sdk.js';
import type * as Protocol from '../../../generated/protocol.js';
import { createLogger } from '../core/Logger.js';
import type {
  MiniAppBridge,
  MiniAppState,
  SPAToDevToolsAction,
  DevToolsToSPAAction,
} from './types/MiniAppTypes.js';

const logger = createLogger('GenericMiniAppBridge');

/**
 * Callback type for handling SPA actions
 */
export type ActionHandler = (action: SPAToDevToolsAction) => void | Promise<void>;

/**
 * GenericMiniAppBridge - CDP-based bidirectional communication for mini apps
 *
 * Uses unique binding names per app type to avoid conflicts:
 * - Binding: __miniAppBridge_{appId}
 *
 * Communication:
 * - SPA → DevTools: Runtime.addBinding (instant, event-driven)
 * - DevTools → SPA: Runtime.evaluate calling window.miniApp.dispatch()
 */
export class GenericMiniAppBridge implements MiniAppBridge {
  private readonly appId: string;
  private readonly bindingName: string;

  private target: SDK.Target.Target | null = null;
  private _webappId: string | null = null;
  private bindingHandler: ((event: { data: Protocol.Runtime.BindingCalledEvent }) => void) | null = null;
  private actionHandler: ActionHandler | null = null;
  private _installed = false;

  constructor(appId: string) {
    this.appId = appId;
    this.bindingName = `__miniAppBridge_${appId}`;
  }

  /**
   * Register a handler for actions from the SPA
   */
  onAction(handler: ActionHandler): void {
    this.actionHandler = handler;
  }

  /**
   * Install the bridge - sets up Runtime.addBinding for SPA→DevTools communication
   */
  async install(webappId: string): Promise<void> {
    if (this._installed) {
      logger.warn(`Bridge for "${this.appId}" already installed`);
      return;
    }

    this._webappId = webappId;
    this.target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();

    if (!this.target) {
      throw new Error('No primary page target available');
    }

    const runtimeModel = this.target.model(SDK.RuntimeModel.RuntimeModel);
    if (!runtimeModel) {
      throw new Error('RuntimeModel not available');
    }

    // Create handler for binding calls
    this.bindingHandler = this.handleBindingCalled.bind(this);
    runtimeModel.addEventListener(SDK.RuntimeModel.Events.BindingCalled, this.bindingHandler);

    // Add the binding - this creates window.__miniAppBridge_{appId}() in the page
    await this.target.runtimeAgent().invoke_addBinding({
      name: this.bindingName,
    });

    this._installed = true;
    logger.info(`Bridge installed for "${this.appId}"`, { webappId, bindingName: this.bindingName });
  }

  /**
   * Uninstall the bridge - removes binding and event listeners
   */
  async uninstall(): Promise<void> {
    if (!this._installed || !this.target) {
      return;
    }

    const runtimeModel = this.target.model(SDK.RuntimeModel.RuntimeModel);

    // Remove event listener
    if (runtimeModel && this.bindingHandler) {
      runtimeModel.removeEventListener(SDK.RuntimeModel.Events.BindingCalled, this.bindingHandler);
    }

    // Remove the binding
    try {
      await this.target.runtimeAgent().invoke_removeBinding({
        name: this.bindingName,
      });
    } catch (error) {
      logger.error(`Failed to remove binding for "${this.appId}":`, error);
    }

    this.bindingHandler = null;
    this.target = null;
    this._webappId = null;
    this._installed = false;

    logger.info(`Bridge uninstalled for "${this.appId}"`);
  }

  /**
   * Send an action to the SPA
   */
  async sendToSPA(action: DevToolsToSPAAction): Promise<void> {
    if (!this.target || !this._webappId) {
      logger.error(`Bridge for "${this.appId}" not installed, cannot send to SPA`);
      return;
    }

    try {
      const runtimeAgent = this.target.runtimeAgent();

      // Call window.miniApp.dispatch() in the iframe context
      await runtimeAgent.invoke_evaluate({
        expression: `
          (() => {
            const iframe = document.getElementById(${JSON.stringify(this._webappId)});
            if (!iframe || !iframe.contentWindow) {
              console.error('[MiniAppBridge] Iframe not found: ${this._webappId}');
              return false;
            }
            if (typeof iframe.contentWindow.miniApp?.dispatch === 'function') {
              iframe.contentWindow.miniApp.dispatch(${JSON.stringify(action)});
              return true;
            }
            console.error('[MiniAppBridge] miniApp.dispatch not found');
            return false;
          })()
        `,
        returnByValue: true,
      });
    } catch (error) {
      logger.error(`Failed to send to SPA for "${this.appId}":`, error);
    }
  }

  /**
   * Get the current state from the SPA
   */
  async getState(): Promise<MiniAppState> {
    if (!this.target || !this._webappId) {
      logger.error(`Bridge for "${this.appId}" not installed, cannot get state`);
      return {};
    }

    try {
      const runtimeAgent = this.target.runtimeAgent();

      const result = await runtimeAgent.invoke_evaluate({
        expression: `
          (() => {
            const iframe = document.getElementById(${JSON.stringify(this._webappId)});
            if (!iframe || !iframe.contentWindow) {
              console.error('[MiniAppBridge] Iframe not found: ${this._webappId}');
              return null;
            }
            if (typeof iframe.contentWindow.miniApp?.getState === 'function') {
              return iframe.contentWindow.miniApp.getState();
            }
            console.error('[MiniAppBridge] miniApp.getState not found');
            return null;
          })()
        `,
        returnByValue: true,
      });

      if (result.exceptionDetails) {
        logger.error(`Exception getting state for "${this.appId}":`, result.exceptionDetails.text);
        return {};
      }

      return (result.result.value as MiniAppState) || {};
    } catch (error) {
      logger.error(`Failed to get state for "${this.appId}":`, error);
      return {};
    }
  }

  /**
   * Handle binding calls from the SPA
   */
  private handleBindingCalled(event: { data: Protocol.Runtime.BindingCalledEvent }): void {
    const { data } = event;

    // Only handle our binding
    if (data.name !== this.bindingName) {
      return;
    }

    try {
      const action = JSON.parse(data.payload) as SPAToDevToolsAction;
      logger.info(`Received action from SPA "${this.appId}":`, action.type);

      if (this.actionHandler) {
        // Handle async actions
        const result = this.actionHandler(action);
        if (result instanceof Promise) {
          result.catch(error => {
            logger.error(`Error handling action for "${this.appId}":`, error);
          });
        }
      }
    } catch (error) {
      logger.error(`Failed to parse SPA action for "${this.appId}":`, error);
    }
  }

  /**
   * Check if bridge is installed
   */
  get installed(): boolean {
    return this._installed;
  }

  /**
   * Get the webapp ID
   */
  get webappId(): string | null {
    return this._webappId;
  }
}
