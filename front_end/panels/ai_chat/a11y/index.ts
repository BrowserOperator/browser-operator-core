// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * A11y Module Index
 *
 * Exports all accessibility-related utilities for frame-aware
 * accessibility tree capture with EncodedId mapping.
 */

// Frame Registry - Track frame hierarchy with ordinals
export {
  FrameRegistry,
  type FrameInfo,
} from './FrameRegistry.js';

// Hybrid Snapshot - Frame-aware accessibility snapshots
export {
  captureHybridSnapshot,
  resolveEncodedIdToXPath,
  resolveEncodedIdToUrl,
  type HybridSnapshot,
  type FrameSnapshot,
  type SnapshotOptions,
} from './HybridSnapshot.js';
