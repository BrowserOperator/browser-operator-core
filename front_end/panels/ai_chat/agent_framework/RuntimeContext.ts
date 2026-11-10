// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Provides environment-agnostic utilities for both browser and Node.js
 */
export interface RuntimeContext {
  generateId(): string;
  now(): Date;
}

// Default implementation works in both environments
export const defaultRuntime: RuntimeContext = {
  generateId: () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for older Node.js
    return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  },
  now: () => new Date(),
};

let currentRuntime = defaultRuntime;

export function getRuntime(): RuntimeContext {
  return currentRuntime;
}

export function setRuntime(runtime: RuntimeContext): void {
  currentRuntime = runtime;
}
