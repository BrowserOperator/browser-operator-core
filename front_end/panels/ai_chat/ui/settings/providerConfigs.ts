// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { i18nString, UIStrings } from './i18n-strings.js';
import type { ProviderConfig } from './providers/GenericProviderSettings.js';
import {
  OPENAI_API_KEY_STORAGE_KEY,
  BROWSEROPERATOR_API_KEY_STORAGE_KEY,
  GROQ_API_KEY_STORAGE_KEY,
  CEREBRAS_API_KEY_STORAGE_KEY,
  ANTHROPIC_API_KEY_STORAGE_KEY,
  GOOGLEAI_API_KEY_STORAGE_KEY,
} from './constants.js';

/**
 * OpenAI provider configuration
 * - API key only
 * - No model fetching (uses static model list)
 * - Has model selectors
 */
export const OpenAIConfig: ProviderConfig = {
  id: 'openai',
  displayName: 'OpenAI',
  apiKeyStorageKey: OPENAI_API_KEY_STORAGE_KEY,
  get apiKeyLabel() { return i18nString(UIStrings.apiKeyLabel); },
  get apiKeyHint() { return i18nString(UIStrings.apiKeyHint); },
  apiKeyPlaceholder: 'Enter your OpenAI API key',
  hasModelSelectors: true,
  hasFetchButton: false,
};

/**
 * BrowserOperator provider configuration
 * - Optional API key
 * - No model fetching
 * - No model selectors (managed service)
 */
export const BrowserOperatorConfig: ProviderConfig = {
  id: 'browseroperator',
  displayName: 'BrowserOperator',
  apiKeyStorageKey: BROWSEROPERATOR_API_KEY_STORAGE_KEY,
  get apiKeyLabel() { return i18nString(UIStrings.browseroperatorApiKeyLabel); },
  get apiKeyHint() { return i18nString(UIStrings.browseroperatorApiKeyHint); },
  apiKeyPlaceholder: 'Enter your BrowserOperator API key (optional)',
  hasModelSelectors: false,
  hasFetchButton: false,
  apiKeyOptional: true,
};

/**
 * Groq provider configuration
 * - API key required
 * - Has model fetching
 * - Has model selectors
 * - Uses model.id for label (no name field)
 */
export const GroqConfig: ProviderConfig = {
  id: 'groq',
  displayName: 'Groq',
  apiKeyStorageKey: GROQ_API_KEY_STORAGE_KEY,
  get apiKeyLabel() { return i18nString(UIStrings.groqApiKeyLabel); },
  get apiKeyHint() { return i18nString(UIStrings.groqApiKeyHint); },
  apiKeyPlaceholder: 'Enter your Groq API key',
  hasModelSelectors: true,
  hasFetchButton: true,
  get fetchButtonLabel() { return i18nString(UIStrings.fetchGroqModelsButton); },
  fetchMethodName: 'fetchGroqModels',
  useNameAsLabel: false,
};

/**
 * Cerebras provider configuration
 * - API key required
 * - Has model fetching
 * - Has model selectors
 * - Uses model.id for label (no name field)
 */
export const CerebrasConfig: ProviderConfig = {
  id: 'cerebras',
  displayName: 'Cerebras',
  apiKeyStorageKey: CEREBRAS_API_KEY_STORAGE_KEY,
  apiKeyLabel: 'Cerebras API Key',
  apiKeyHint: 'Your Cerebras API key for authentication',
  apiKeyPlaceholder: 'Enter your Cerebras API key',
  hasModelSelectors: true,
  hasFetchButton: true,
  fetchButtonLabel: 'Fetch Cerebras Models',
  fetchMethodName: 'fetchCerebrasModels',
  useNameAsLabel: false,
};

/**
 * Anthropic provider configuration
 * - API key required
 * - Has model fetching
 * - Has model selectors
 * - Uses model.name || model.id for label
 */
export const AnthropicConfig: ProviderConfig = {
  id: 'anthropic',
  displayName: 'Anthropic',
  apiKeyStorageKey: ANTHROPIC_API_KEY_STORAGE_KEY,
  apiKeyLabel: 'Anthropic API Key',
  apiKeyHint: 'Your Anthropic API key for authentication',
  apiKeyPlaceholder: 'Enter your Anthropic API key',
  hasModelSelectors: true,
  hasFetchButton: true,
  fetchButtonLabel: 'Fetch Anthropic Models',
  fetchMethodName: 'fetchAnthropicModels',
  useNameAsLabel: true,
};

/**
 * Google AI provider configuration
 * - API key required
 * - Has model fetching
 * - Has model selectors
 * - Uses model.name || model.id for label
 */
export const GoogleAIConfig: ProviderConfig = {
  id: 'googleai',
  displayName: 'Google AI',
  apiKeyStorageKey: GOOGLEAI_API_KEY_STORAGE_KEY,
  apiKeyLabel: 'Google AI API Key',
  apiKeyHint: 'Your Google AI API key for authentication',
  apiKeyPlaceholder: 'Enter your Google AI API key',
  hasModelSelectors: true,
  hasFetchButton: true,
  fetchButtonLabel: 'Fetch Google AI Models',
  fetchMethodName: 'fetchGoogleAIModels',
  useNameAsLabel: true,
};

/**
 * List of all generic providers for easy iteration
 */
export const GENERIC_PROVIDERS = [
  OpenAIConfig,
  BrowserOperatorConfig,
  GroqConfig,
  CerebrasConfig,
  AnthropicConfig,
  GoogleAIConfig,
];
