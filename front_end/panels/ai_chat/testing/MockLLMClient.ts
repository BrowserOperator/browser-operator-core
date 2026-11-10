// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Mock LLM Client for testing agent execution.
 * Provides a queueable response system for deterministic testing.
 */

import type { LLMResponse, LLMMessage } from '../LLM/LLMTypes.js';
import { LLMClient } from '../LLM/LLMClient.js';

// ============================================================================
// Types
// ============================================================================

export type MockLLMResponseType = 'tool_call' | 'final_answer' | 'error';

export interface MockLLMResponseConfig {
  type: MockLLMResponseType;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  answer?: string;
  errorMessage?: string;
  reasoning?: string;
}

export interface LLMCallRecord {
  messages: LLMMessage[];
  tools: unknown[];
  systemPrompt?: string;
  model?: string;
  timestamp: Date;
}

// ============================================================================
// MockLLMClient
// ============================================================================

/**
 * Mock LLM Client with queueable responses for testing.
 */
export class MockLLMClient {
  private responseQueue: MockLLMResponseConfig[] = [];
  private callHistory: LLMCallRecord[] = [];
  private defaultResponse: MockLLMResponseConfig = { type: 'final_answer', answer: 'Default response' };
  private callIndex = 0;

  /**
   * Queue a response to be returned on the next LLM call.
   */
  queueResponse(config: MockLLMResponseConfig): this {
    this.responseQueue.push(config);
    return this;
  }

  /**
   * Queue multiple responses.
   */
  queueResponses(configs: MockLLMResponseConfig[]): this {
    this.responseQueue.push(...configs);
    return this;
  }

  /**
   * Queue a tool call response.
   */
  queueToolCall(toolName: string, toolArgs: Record<string, unknown> = {}, reasoning?: string): this {
    return this.queueResponse({ type: 'tool_call', toolName, toolArgs, reasoning });
  }

  /**
   * Queue a final answer response.
   */
  queueFinalAnswer(answer: string, reasoning?: string): this {
    return this.queueResponse({ type: 'final_answer', answer, reasoning });
  }

  /**
   * Queue an error response.
   */
  queueError(errorMessage: string): this {
    return this.queueResponse({ type: 'error', errorMessage });
  }

  /**
   * Set the default response when queue is empty.
   */
  setDefaultResponse(config: MockLLMResponseConfig): this {
    this.defaultResponse = config;
    return this;
  }

  /**
   * Get the call history.
   */
  getCallHistory(): LLMCallRecord[] {
    return [...this.callHistory];
  }

  /**
   * Get the number of calls made.
   */
  getCallCount(): number {
    return this.callHistory.length;
  }

  /**
   * Assert the number of calls made.
   */
  assertCallCount(expected: number): void {
    if (this.callHistory.length !== expected) {
      throw new Error(`Expected ${expected} LLM calls, but got ${this.callHistory.length}`);
    }
  }

  /**
   * Reset the mock client state.
   */
  reset(): void {
    this.responseQueue = [];
    this.callHistory = [];
    this.callIndex = 0;
  }

  /**
   * Get the next response from the queue (or default).
   */
  private getNextResponse(): MockLLMResponseConfig {
    if (this.responseQueue.length > 0) {
      return this.responseQueue.shift()!;
    }
    return this.defaultResponse;
  }

  /**
   * Create a mock LLM call implementation.
   */
  createCallImplementation(): (params: any) => Promise<LLMResponse> {
    return async (params: any): Promise<LLMResponse> => {
      this.callHistory.push({
        messages: params.messages || [],
        tools: params.tools || [],
        systemPrompt: params.systemPrompt,
        model: params.model,
        timestamp: new Date(),
      });

      const responseConfig = this.getNextResponse();

      // Build the raw response based on config
      const rawResponse: any = {
        id: `chatcmpl-mock-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: params.model || 'mock-model',
        choices: [
          {
            index: 0,
            message: this.buildMessage(responseConfig),
            finish_reason: responseConfig.type === 'tool_call' ? 'tool_calls' : 'stop',
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      };

      return {
        rawResponse,
        reasoning: responseConfig.reasoning ? { summary: [responseConfig.reasoning] } : undefined,
      };
    };
  }

  /**
   * Create a mock parseResponse implementation.
   */
  createParseResponseImplementation(): (response: LLMResponse) => { type: string; name?: string; args?: Record<string, unknown>; answer?: string; error?: string } {
    return (response: LLMResponse) => {
      const message = response.rawResponse?.choices?.[0]?.message;

      if (message?.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        return {
          type: 'tool_call',
          name: toolCall.function?.name,
          args: toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {},
        };
      }

      if (message?.content?.startsWith('ERROR:')) {
        return {
          type: 'error',
          error: message.content.replace('ERROR:', '').trim(),
        };
      }

      return {
        type: 'final_answer',
        answer: message?.content || '',
      };
    };
  }

  /**
   * Build a message object from response config.
   */
  private buildMessage(config: MockLLMResponseConfig): any {
    if (config.type === 'tool_call' && config.toolName) {
      return {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: `call_mock_${Date.now()}`,
            type: 'function',
            function: {
              name: config.toolName,
              arguments: JSON.stringify(config.toolArgs || {}),
            },
          },
        ],
      };
    }

    if (config.type === 'error') {
      return {
        role: 'assistant',
        content: `ERROR: ${config.errorMessage || 'Unknown error'}`,
      };
    }

    return {
      role: 'assistant',
      content: config.answer || '',
    };
  }

  /**
   * Install this mock client as the LLMClient singleton.
   * Returns a cleanup function to restore the original.
   */
  install(): () => void {
    const originalGetInstance = LLMClient.getInstance;
    const mockClient = {
      call: this.createCallImplementation(),
      parseResponse: this.createParseResponseImplementation(),
    };

    (LLMClient as any).getInstance = () => mockClient;

    return () => {
      (LLMClient as any).getInstance = originalGetInstance;
    };
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Creates and installs a mock LLM client with a predefined sequence.
 */
export function setupMockLLMClient(sequence: MockLLMResponseConfig[]): {
  client: MockLLMClient;
  cleanup: () => void;
} {
  const client = new MockLLMClient();
  client.queueResponses(sequence);
  const cleanup = client.install();
  return { client, cleanup };
}

/**
 * Creates a simple tool call -> final answer sequence.
 */
export function createToolThenAnswerSequence(
  toolName: string,
  toolArgs: Record<string, unknown>,
  answer: string
): MockLLMResponseConfig[] {
  return [
    { type: 'tool_call', toolName, toolArgs },
    { type: 'final_answer', answer },
  ];
}

/**
 * Creates a multi-tool sequence ending with a final answer.
 */
export function createMultiToolSequence(
  tools: Array<{ toolName: string; toolArgs?: Record<string, unknown> }>,
  answer: string
): MockLLMResponseConfig[] {
  const sequence: MockLLMResponseConfig[] = tools.map(t => ({
    type: 'tool_call' as const,
    toolName: t.toolName,
    toolArgs: t.toolArgs || {},
  }));
  sequence.push({ type: 'final_answer', answer });
  return sequence;
}
