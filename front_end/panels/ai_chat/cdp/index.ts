/**
 * CDP Abstraction Layer
 *
 * This module provides a unified interface for accessing Chrome DevTools Protocol
 * that works in both DevTools browser context and Node.js/eval runner context.
 */

export type {CDPAgent, CDPSessionAdapter, CDPDomain} from './CDPSessionAdapter.js';
export {SDKTargetAdapter} from './SDKTargetAdapter.js';
export {DirectCDPAdapter} from './DirectCDPAdapter.js';
export type {CDPClient} from './DirectCDPAdapter.js';
export {getAdapter, getAdapterIfLoaded, preloadBrowserDeps} from './getAdapter.js';
export type {AdapterContext} from './getAdapter.js';
