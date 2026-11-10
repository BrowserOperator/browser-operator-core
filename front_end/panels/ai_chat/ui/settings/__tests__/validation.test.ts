// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {
  validateModelSelection,
  validateApiKey,
  validateEndpoint,
} from '../utils/validation.js';

type ModelOption = {
  value: string;
  label: string;
  type?: string;
};

describe('Validation Utilities', () => {
  describe('validateModelSelection', () => {
    const mockModels: ModelOption[] = [
      {value: 'gpt-4', label: 'GPT-4'},
      {value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo'},
      {value: 'claude-3-opus', label: 'Claude 3 Opus'},
    ];

    it('returns true for valid model selection', () => {
      assert.isTrue(validateModelSelection('gpt-4', mockModels));
      assert.isTrue(validateModelSelection('gpt-3.5-turbo', mockModels));
      assert.isTrue(validateModelSelection('claude-3-opus', mockModels));
    });

    it('returns false for invalid model selection', () => {
      assert.isFalse(validateModelSelection('invalid-model', mockModels));
      assert.isFalse(validateModelSelection('GPT-4', mockModels)); // Case sensitive
    });

    it('returns true for empty selection (will use default)', () => {
      assert.isTrue(validateModelSelection('', mockModels));
    });

    it('returns true for empty model list with empty selection', () => {
      assert.isTrue(validateModelSelection('', []));
    });

    it('returns false for non-existent model in empty list', () => {
      assert.isFalse(validateModelSelection('some-model', []));
    });

    it('handles model values with special characters', () => {
      const modelsWithSpecialChars: ModelOption[] = [
        {value: 'openai/gpt-4', label: 'OpenAI GPT-4'},
        {value: 'anthropic/claude-3', label: 'Anthropic Claude 3'},
      ];
      assert.isTrue(validateModelSelection('openai/gpt-4', modelsWithSpecialChars));
      assert.isTrue(validateModelSelection('anthropic/claude-3', modelsWithSpecialChars));
    });
  });

  describe('validateApiKey', () => {
    it('returns true for non-empty API key', () => {
      assert.isTrue(validateApiKey('sk-1234567890'));
      assert.isTrue(validateApiKey('API_KEY'));
      assert.isTrue(validateApiKey('a'));
    });

    it('returns false for empty API key', () => {
      assert.isFalse(validateApiKey(''));
    });

    it('returns false for whitespace-only API key', () => {
      assert.isFalse(validateApiKey('   '));
      assert.isFalse(validateApiKey('\t'));
      assert.isFalse(validateApiKey('\n'));
      assert.isFalse(validateApiKey('  \t\n  '));
    });

    it('returns true for API key with leading/trailing whitespace', () => {
      // After trim, there's still content
      assert.isTrue(validateApiKey('  sk-123  '));
    });

    it('handles very long API keys', () => {
      const longKey = 'sk-' + 'A'.repeat(1000);
      assert.isTrue(validateApiKey(longKey));
    });

    it('handles API keys with special characters', () => {
      assert.isTrue(validateApiKey('sk-proj-1234_5678-abcd'));
      assert.isTrue(validateApiKey('API:KEY/with.special+chars'));
    });
  });

  describe('validateEndpoint', () => {
    it('returns true for valid HTTP URLs', () => {
      assert.isTrue(validateEndpoint('http://localhost:8080'));
      assert.isTrue(validateEndpoint('http://example.com'));
      assert.isTrue(validateEndpoint('http://192.168.1.1:3000'));
    });

    it('returns true for valid HTTPS URLs', () => {
      assert.isTrue(validateEndpoint('https://api.openai.com'));
      assert.isTrue(validateEndpoint('https://api.example.com/v1'));
      assert.isTrue(validateEndpoint('https://example.com:443/path'));
    });

    it('returns true for URLs with paths', () => {
      assert.isTrue(validateEndpoint('https://api.example.com/v1/chat/completions'));
      assert.isTrue(validateEndpoint('http://localhost:8080/api'));
    });

    it('returns true for URLs with query parameters', () => {
      assert.isTrue(validateEndpoint('https://api.example.com?key=value'));
      assert.isTrue(validateEndpoint('https://example.com/path?a=1&b=2'));
    });

    it('returns false for empty string', () => {
      assert.isFalse(validateEndpoint(''));
    });

    it('returns false for whitespace-only string', () => {
      assert.isFalse(validateEndpoint('   '));
      assert.isFalse(validateEndpoint('\t\n'));
    });

    it('returns false for invalid URLs', () => {
      assert.isFalse(validateEndpoint('not-a-url'));
      assert.isFalse(validateEndpoint('just text'));
      assert.isFalse(validateEndpoint('ftp://invalid-scheme.com')); // ftp is valid URL though...
    });

    it('returns false for URLs missing protocol', () => {
      assert.isFalse(validateEndpoint('api.example.com'));
      assert.isFalse(validateEndpoint('localhost:8080'));
    });

    it('handles URLs with ports', () => {
      assert.isTrue(validateEndpoint('http://localhost:3000'));
      assert.isTrue(validateEndpoint('https://api.example.com:8443'));
    });

    it('handles URLs with authentication', () => {
      assert.isTrue(validateEndpoint('http://user:pass@example.com'));
    });

    it('handles URLs with fragments', () => {
      assert.isTrue(validateEndpoint('https://example.com/page#section'));
    });

    it('handles localhost variants', () => {
      assert.isTrue(validateEndpoint('http://localhost'));
      assert.isTrue(validateEndpoint('http://127.0.0.1'));
      assert.isTrue(validateEndpoint('http://[::1]'));
    });
  });

  describe('Edge Cases', () => {
    it('validateApiKey handles unicode', () => {
      // API keys typically shouldn't have unicode, but function should handle it
      assert.isTrue(validateApiKey('\u4E2D\u6587'));
    });

    it('validateEndpoint with unusual but valid URLs', () => {
      // data URLs are technically valid URLs
      assert.isTrue(validateEndpoint('data:text/plain;base64,SGVsbG8='));

      // blob URLs
      assert.isTrue(validateEndpoint('blob:https://example.com/uuid'));
    });

    it('validateModelSelection with whitespace in values', () => {
      const models: ModelOption[] = [
        {value: 'model with spaces', label: 'Model'},
      ];
      assert.isTrue(validateModelSelection('model with spaces', models));
      assert.isFalse(validateModelSelection('model_with_spaces', models));
    });
  });
});
