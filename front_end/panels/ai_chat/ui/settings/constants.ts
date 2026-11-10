// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Local storage keys for model selection
 */
export const MINI_MODEL_STORAGE_KEY = 'ai_chat_mini_model';
export const NANO_MODEL_STORAGE_KEY = 'ai_chat_nano_model';

/**
 * Local storage keys for provider configuration
 */
export const PROVIDER_SELECTION_KEY = 'ai_chat_provider';

/**
 * Local storage keys for API keys
 */
export const OPENAI_API_KEY_STORAGE_KEY = 'ai_chat_api_key';
export const LITELLM_ENDPOINT_KEY = 'ai_chat_litellm_endpoint';
export const LITELLM_API_KEY_STORAGE_KEY = 'ai_chat_litellm_api_key';
export const GROQ_API_KEY_STORAGE_KEY = 'ai_chat_groq_api_key';
export const OPENROUTER_API_KEY_STORAGE_KEY = 'ai_chat_openrouter_api_key';
export const BROWSEROPERATOR_API_KEY_STORAGE_KEY = 'ai_chat_browseroperator_api_key';
export const CEREBRAS_API_KEY_STORAGE_KEY = 'ai_chat_cerebras_api_key';
export const ANTHROPIC_API_KEY_STORAGE_KEY = 'ai_chat_anthropic_api_key';
export const GOOGLEAI_API_KEY_STORAGE_KEY = 'ai_chat_googleai_api_key';

/**
 * Cache constants
 */
export const OPENROUTER_MODELS_CACHE_DURATION_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Vector DB configuration keys - Milvus format
 */
export const VECTOR_DB_ENABLED_KEY = 'ai_chat_vector_db_enabled';
export const MILVUS_ENDPOINT_KEY = 'ai_chat_milvus_endpoint';
export const MILVUS_USERNAME_KEY = 'ai_chat_milvus_username';
export const MILVUS_PASSWORD_KEY = 'ai_chat_milvus_password';
export const MILVUS_COLLECTION_KEY = 'ai_chat_milvus_collection';
export const MILVUS_OPENAI_KEY = 'ai_chat_milvus_openai_key';

/**
 * Advanced settings toggle key
 */
export const ADVANCED_SETTINGS_ENABLED_KEY = 'ai_chat_advanced_settings_enabled';

/**
 * Memory system toggle key
 */
export const MEMORY_ENABLED_KEY = 'ai_chat_memory_enabled';

/**
 * Panel filter toggle key - controls whether only AI Chat panel is shown
 */
export const PANEL_FILTER_ENABLED_KEY = 'ai_chat_panel_filter_enabled';
