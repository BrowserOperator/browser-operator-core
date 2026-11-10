// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as SDK from '../../../core/sdk/sdk.js';
import type * as Protocol from '../../../generated/protocol.js';
import { createLogger } from '../core/Logger.js';

const logger = createLogger('AgentStudioBridge');

const AGENT_STUDIO_BINDING_NAME = '__agentStudioBridge';

/**
 * Action types from SPA to DevTools
 */
export type SPAAction =
  | { type: 'select-agent'; name: string; id: string | null; isBuiltIn: boolean }
  | { type: 'new-agent' }
  | { type: 'save-agent'; data: AgentFormData }
  | { type: 'delete-agent' }
  | { type: 'clone-agent' }
  | { type: 'run-test'; query: string }
  | { type: 'close' }
  | { type: 'ready' };  // SPA signals it's ready to receive data

/**
 * Form data for saving agents
 */
export interface AgentFormData {
  name: string;
  displayName: string;
  description: string;
  avatar: string;
  color: string;
  systemPrompt: string;
  tools: string[];
  maxIterations: number;
  temperature: number;
  schema: object;
}

/**
 * Action types from DevTools to SPA
 */
export type DevToolsAction =
  | { action: 'init'; payload: InitPayload }
  | { action: 'agents-updated'; payload: { agents: AgentInfo[] } }
  | { action: 'agent-selected'; payload: { agent: AgentInfo } }
  | { action: 'agent-saved'; payload: { agent: AgentInfo } }
  | { action: 'notification'; payload: { message: string; type: 'success' | 'error' | 'warning' } }
  | { action: 'test-result'; payload: { html: string } };

export interface InitPayload {
  agents: AgentInfo[];
  tools: ToolInfo[];
  selectedAgent?: AgentInfo;
}

export interface AgentInfo {
  id?: string;
  name: string;
  displayName: string;
  description: string;
  avatar: string;
  color: string;
  backgroundColor: string;
  isBuiltIn: boolean;
  tools: string[];
  maxIterations: number;
  temperature: number;
  systemPrompt: string;
  version: string;
  schema: object;
}

export interface ToolInfo {
  name: string;
  description: string;
}

/**
 * Callback type for handling SPA actions
 */
export type ActionHandler = (action: SPAAction) => void | Promise<void>;

/**
 * AgentStudioBridge - Handles bidirectional communication between DevTools and Agent Studio SPA
 *
 * Uses CDP Runtime.addBinding for instant SPA→DevTools communication (no polling)
 * Uses CDP Runtime.evaluate for DevTools→SPA communication
 */
export class AgentStudioBridge {
  private target: SDK.Target.Target | null = null;
  private webappId: string | null = null;
  private bindingHandler: ((event: { data: Protocol.Runtime.BindingCalledEvent }) => void) | null = null;
  private actionHandler: ActionHandler | null = null;
  private isInstalled = false;

  /**
   * Set the action handler for SPA events
   */
  onAction(handler: ActionHandler): void {
    this.actionHandler = handler;
  }

  /**
   * Install the bridge - sets up Runtime.addBinding for SPA→DevTools communication
   */
  async install(webappId: string): Promise<void> {
    if (this.isInstalled) {
      logger.warn('Bridge already installed');
      return;
    }

    this.webappId = webappId;
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

    // Add the binding - this creates window.__agentStudioBridge() in the page
    await this.target.runtimeAgent().invoke_addBinding({
      name: AGENT_STUDIO_BINDING_NAME,
    });

    this.isInstalled = true;
    logger.info('Bridge installed', { webappId });
  }

  /**
   * Uninstall the bridge - removes binding and event listeners
   */
  async uninstall(): Promise<void> {
    if (!this.isInstalled || !this.target) {
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
        name: AGENT_STUDIO_BINDING_NAME,
      });
    } catch (error) {
      logger.error('Failed to remove binding:', error);
    }

    this.bindingHandler = null;
    this.target = null;
    this.webappId = null;
    this.isInstalled = false;

    logger.info('Bridge uninstalled');
  }

  /**
   * Send an action to the SPA
   */
  async sendToSPA(action: DevToolsAction): Promise<void> {
    if (!this.target || !this.webappId) {
      logger.error('Bridge not installed, cannot send to SPA');
      return;
    }

    try {
      const runtimeAgent = this.target.runtimeAgent();

      // Call window.agentStudio.dispatch() in the iframe context
      await runtimeAgent.invoke_evaluate({
        expression: `
          (() => {
            const iframe = document.getElementById(${JSON.stringify(this.webappId)});
            if (!iframe || !iframe.contentWindow) {
              console.error('Agent Studio iframe not found');
              return false;
            }
            if (typeof iframe.contentWindow.agentStudio?.dispatch === 'function') {
              iframe.contentWindow.agentStudio.dispatch(${JSON.stringify(action)});
              return true;
            }
            console.error('agentStudio.dispatch not found');
            return false;
          })()
        `,
        returnByValue: true,
      });
    } catch (error) {
      logger.error('Failed to send to SPA:', error);
    }
  }

  /**
   * Handle binding calls from the SPA
   */
  private handleBindingCalled(event: { data: Protocol.Runtime.BindingCalledEvent }): void {
    const { data } = event;

    // Only handle our binding
    if (data.name !== AGENT_STUDIO_BINDING_NAME) {
      return;
    }

    try {
      const action = JSON.parse(data.payload) as SPAAction;
      logger.info('Received action from SPA:', action.type);

      if (this.actionHandler) {
        // Handle async actions
        const result = this.actionHandler(action);
        if (result instanceof Promise) {
          result.catch(error => {
            logger.error('Error handling action:', error);
          });
        }
      }
    } catch (error) {
      logger.error('Failed to parse SPA action:', error);
    }
  }

  /**
   * Check if bridge is installed
   */
  get installed(): boolean {
    return this.isInstalled;
  }
}
