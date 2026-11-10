// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Mini Apps System
 *
 * A generic system for rendering self-contained UI applications as full-screen
 * iframes with full AI read/write control over their state.
 *
 * Usage:
 *
 * 1. Define a mini app by implementing the MiniApp interface:
 *
 *    class MyMiniApp implements MiniApp {
 *      id = 'my_app';
 *      name = 'My App';
 *      description = 'Does something cool';
 *      icon = '🎯';
 *
 *      getSPA(): MiniAppSPA { ... }
 *      getSupportedActions(): MiniAppActionSchema[] { ... }
 *      getStateSchema(): MiniAppStateSchema { ... }
 *      createController(): MiniAppController { ... }
 *    }
 *
 * 2. Register the app:
 *
 *    MiniAppRegistry.register(new MyMiniApp());
 *
 * 3. Launch the app:
 *
 *    const instance = await MiniAppRegistry.launch('my_app');
 *
 * 4. Interact with the app:
 *
 *    const state = await instance.controller.getState();
 *    await instance.controller.executeAction('do-something', { arg: 'value' });
 *
 * 5. Close the app:
 *
 *    await MiniAppRegistry.close('my_app');
 */

// Types
export * from './types/MiniAppTypes.js';

// Core
export { MiniAppRegistry } from './MiniAppRegistry.js';
export { GenericMiniAppBridge } from './GenericMiniAppBridge.js';
export { MiniAppStorageManager } from './MiniAppStorageManager.js';
export { MiniAppEventBus, Events as MiniAppEvents } from './MiniAppEventBus.js';

// Initialization
export { initializeMiniApps, isMiniAppSystemInitialized, resetMiniAppSystem } from './MiniAppInitialization.js';

// Apps
export { AgentStudioMiniApp } from './apps/agent_studio/AgentStudioMiniApp.js';
