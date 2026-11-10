// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Common from '../../../core/common/common.js';
import { createLogger } from '../core/Logger.js';
import type { MiniAppEvent, MiniAppEventType } from './types/MiniAppTypes.js';

const logger = createLogger('MiniAppEventBus');

/**
 * Event types for the MiniAppEventBus
 */
export const enum Events {
  MiniAppEvent = 'MiniAppEvent',
}

/**
 * Type definition for event data
 */
export type EventTypes = {
  [Events.MiniAppEvent]: MiniAppEvent;
};

/**
 * MiniAppEventBus - Event propagation system for mini apps
 *
 * Allows components to subscribe to mini app lifecycle events:
 * - app_launched: When a mini app is launched
 * - app_closed: When a mini app is closed
 * - state_changed: When a mini app's state changes
 * - action_received: When an action is received from a mini app
 * - action_executed: When an action is executed on a mini app
 * - error: When an error occurs in a mini app
 *
 * Uses DevTools' Common.ObjectWrapper for event handling.
 */
export class MiniAppEventBus extends Common.ObjectWrapper.ObjectWrapper<EventTypes> {
  private static instance: MiniAppEventBus | null = null;

  private constructor() {
    super();
    logger.info('Initialized MiniAppEventBus');
  }

  static getInstance(): MiniAppEventBus {
    if (!MiniAppEventBus.instance) {
      MiniAppEventBus.instance = new MiniAppEventBus();
    }
    return MiniAppEventBus.instance;
  }

  /**
   * Emit a mini app event
   */
  emit(event: MiniAppEvent): void {
    logger.debug(`Emitting event: ${event.type} for app "${event.appId}"`);
    this.dispatchEventToListeners(Events.MiniAppEvent, event);
  }

  /**
   * Subscribe to all mini app events
   */
  subscribe(callback: (event: MiniAppEvent) => void): () => void {
    const handler = (event: Common.EventTarget.EventTargetEvent<MiniAppEvent>) => {
      callback(event.data);
    };

    this.addEventListener(Events.MiniAppEvent, handler);

    // Return unsubscribe function
    return () => {
      this.removeEventListener(Events.MiniAppEvent, handler);
    };
  }

  /**
   * Subscribe to events for a specific app
   */
  subscribeToApp(appId: string, callback: (event: MiniAppEvent) => void): () => void {
    const handler = (event: Common.EventTarget.EventTargetEvent<MiniAppEvent>) => {
      if (event.data.appId === appId) {
        callback(event.data);
      }
    };

    this.addEventListener(Events.MiniAppEvent, handler);

    // Return unsubscribe function
    return () => {
      this.removeEventListener(Events.MiniAppEvent, handler);
    };
  }

  /**
   * Subscribe to a specific event type
   */
  subscribeToType(eventType: MiniAppEventType, callback: (event: MiniAppEvent) => void): () => void {
    const handler = (event: Common.EventTarget.EventTargetEvent<MiniAppEvent>) => {
      if (event.data.type === eventType) {
        callback(event.data);
      }
    };

    this.addEventListener(Events.MiniAppEvent, handler);

    // Return unsubscribe function
    return () => {
      this.removeEventListener(Events.MiniAppEvent, handler);
    };
  }

  /**
   * Subscribe to a specific event type for a specific app
   */
  subscribeToAppEvent(
    appId: string,
    eventType: MiniAppEventType,
    callback: (event: MiniAppEvent) => void
  ): () => void {
    const handler = (event: Common.EventTarget.EventTargetEvent<MiniAppEvent>) => {
      if (event.data.appId === appId && event.data.type === eventType) {
        callback(event.data);
      }
    };

    this.addEventListener(Events.MiniAppEvent, handler);

    // Return unsubscribe function
    return () => {
      this.removeEventListener(Events.MiniAppEvent, handler);
    };
  }

  /**
   * Wait for a specific event (Promise-based)
   */
  waitForEvent(
    appId: string,
    eventType: MiniAppEventType,
    timeout?: number
  ): Promise<MiniAppEvent> {
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const unsubscribe = this.subscribeToAppEvent(appId, eventType, (event) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        unsubscribe();
        resolve(event);
      });

      if (timeout) {
        timeoutId = setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timeout waiting for "${eventType}" event from "${appId}"`));
        }, timeout);
      }
    });
  }

  /**
   * Helper: Create and emit an app_launched event
   */
  emitLaunched(appId: string, data?: unknown): void {
    this.emit({
      type: 'app_launched',
      appId,
      timestamp: new Date(),
      data,
    });
  }

  /**
   * Helper: Create and emit an app_closed event
   */
  emitClosed(appId: string, data?: unknown): void {
    this.emit({
      type: 'app_closed',
      appId,
      timestamp: new Date(),
      data,
    });
  }

  /**
   * Helper: Create and emit a state_changed event
   */
  emitStateChanged(appId: string, state: unknown): void {
    this.emit({
      type: 'state_changed',
      appId,
      timestamp: new Date(),
      data: state,
    });
  }

  /**
   * Helper: Create and emit an action_received event
   */
  emitActionReceived(appId: string, action: unknown): void {
    this.emit({
      type: 'action_received',
      appId,
      timestamp: new Date(),
      data: action,
    });
  }

  /**
   * Helper: Create and emit an action_executed event
   */
  emitActionExecuted(appId: string, action: string, result: unknown): void {
    this.emit({
      type: 'action_executed',
      appId,
      timestamp: new Date(),
      data: { action, result },
    });
  }

  /**
   * Helper: Create and emit an error event
   */
  emitError(appId: string, error: Error | string): void {
    this.emit({
      type: 'error',
      appId,
      timestamp: new Date(),
      data: { error: error instanceof Error ? error.message : error },
    });
  }
}
