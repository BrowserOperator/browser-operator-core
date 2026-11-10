// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Shared test utilities for the AI Chat agent framework.
 * Provides mock factories, state builders, and assertion helpers.
 */

import type { Tool } from '../tools/Tools.js';
import type { AgentToolConfig, CallCtx, ConfigurableAgentArgs, ConfigurableAgentResult } from '../agent_framework/ConfigurableAgentTool.js';
import type { AgentRunnerConfig, AgentRunnerHooks } from '../agent_framework/AgentRunner.js';
import type { AgentSession, AgentMessage } from '../agent_framework/AgentSessionTypes.js';
import { ChatMessageEntity, type ChatMessage, type ModelChatMessage, type ToolResultMessage } from '../models/ChatTypes.js';
import type { LLMProvider } from '../LLM/LLMTypes.js';

// ============================================================================
// Mock Tool Factory
// ============================================================================

/**
 * Creates a minimal mock tool for testing.
 */
export function createMockTool<TArgs = Record<string, unknown>, TResult = unknown>(
  name: string,
  executeImpl?: (args: TArgs, ctx?: unknown) => Promise<TResult>,
  options?: {
    description?: string;
    schema?: { type: string; properties: Record<string, unknown>; required?: string[] };
  }
): Tool<TArgs, TResult> {
  return {
    name,
    description: options?.description ?? `Test tool: ${name}`,
    schema: options?.schema ?? { type: 'object', properties: {} },
    execute: executeImpl ?? (async () => ({ success: true } as unknown as TResult)),
  };
}

/**
 * Creates a mock tool that returns a specific result.
 */
export function createMockToolWithResult<T>(name: string, result: T): Tool<Record<string, unknown>, T> {
  return createMockTool(name, async () => result);
}

/**
 * Creates a mock tool that throws an error.
 */
export function createMockToolWithError(name: string, errorMessage: string): Tool<Record<string, unknown>, never> {
  return createMockTool(name, async () => {
    throw new Error(errorMessage);
  });
}

/**
 * Creates a mock tool that tracks calls.
 */
export function createTrackedMockTool<TArgs = Record<string, unknown>, TResult = unknown>(
  name: string,
  result: TResult
): Tool<TArgs, TResult> & { calls: Array<{ args: TArgs; ctx?: unknown }> } {
  const calls: Array<{ args: TArgs; ctx?: unknown }> = [];
  const tool = createMockTool<TArgs, TResult>(name, async (args, ctx) => {
    calls.push({ args, ctx });
    return result;
  });
  return Object.assign(tool, { calls });
}

// ============================================================================
// Mock CallCtx Factory
// ============================================================================

/**
 * Creates a mock CallCtx for testing.
 */
export function createMockCallCtx(overrides?: Partial<CallCtx>): CallCtx {
  return {
    apiKey: 'test-api-key',
    provider: 'openai' as LLMProvider,
    model: 'gpt-4.1-2025-04-14',
    miniModel: 'gpt-4.1-mini-2025-04-14',
    nanoModel: 'gpt-4.1-nano-2025-04-14',
    mainModel: 'gpt-4.1-2025-04-14',
    getVisionCapability: async () => false,
    ...overrides,
  };
}

// ============================================================================
// Mock AgentToolConfig Factory
// ============================================================================

/**
 * Creates a minimal mock AgentToolConfig for testing.
 */
export function createMockAgentToolConfig(overrides?: Partial<AgentToolConfig>): AgentToolConfig {
  const name = overrides?.name ?? 'test_agent';
  return {
    name,
    description: `Test agent: ${name}`,
    systemPrompt: 'You are a test agent.',
    tools: [],
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The task to perform' },
        reasoning: { type: 'string', description: 'Why this agent was invoked' },
      },
      required: ['query', 'reasoning'],
    },
    maxIterations: 5,
    temperature: 0,
    ...overrides,
  };
}

// ============================================================================
// Mock AgentRunnerConfig Factory
// ============================================================================

/**
 * Creates a mock AgentRunnerConfig for testing.
 */
export function createMockAgentRunnerConfig(overrides?: Partial<AgentRunnerConfig>): AgentRunnerConfig {
  return {
    apiKey: 'test-api-key',
    modelName: 'gpt-4.1-2025-04-14',
    systemPrompt: 'You are a test agent.',
    tools: [],
    maxIterations: 5,
    temperature: 0,
    provider: 'openai' as LLMProvider,
    getVisionCapability: async () => false,
    ...overrides,
  };
}

// ============================================================================
// Mock AgentRunnerHooks Factory
// ============================================================================

/**
 * Creates default AgentRunnerHooks for testing.
 */
export function createMockAgentRunnerHooks(overrides?: Partial<AgentRunnerHooks>): AgentRunnerHooks {
  return {
    prepareInitialMessages: undefined,
    createSuccessResult: (output, intermediateSteps, reason) => ({
      success: true,
      output,
      intermediateSteps,
      terminationReason: reason,
    }),
    createErrorResult: (error, intermediateSteps, reason) => ({
      success: false,
      error,
      intermediateSteps,
      terminationReason: reason,
    }),
    ...overrides,
  };
}

// ============================================================================
// Message Builders
// ============================================================================

/**
 * Creates a user message.
 */
export function createUserMessage(text: string): ChatMessage {
  return {
    entity: ChatMessageEntity.USER,
    text,
  } as ChatMessage;
}

/**
 * Creates a model message with a tool call.
 */
export function createToolCallMessage(
  toolName: string,
  toolArgs: Record<string, unknown>,
  options?: {
    toolCallId?: string;
    reasoning?: string;
  }
): ModelChatMessage {
  return {
    entity: ChatMessageEntity.MODEL,
    action: 'tool',
    toolName,
    toolArgs,
    toolCallId: options?.toolCallId ?? crypto.randomUUID(),
    isFinalAnswer: false,
    reasoning: options?.reasoning ? [options.reasoning] : undefined,
  };
}

/**
 * Creates a tool result message.
 */
export function createToolResultMessage(
  toolName: string,
  result: unknown,
  options?: {
    toolCallId?: string;
    isError?: boolean;
    imageData?: string;
  }
): ToolResultMessage {
  const isError = options?.isError ?? false;
  const resultText = typeof result === 'string' ? result : JSON.stringify(result);

  return {
    entity: ChatMessageEntity.TOOL_RESULT,
    toolName,
    toolCallId: options?.toolCallId ?? crypto.randomUUID(),
    resultText,
    isError,
    ...(isError && { error: resultText }),
    ...(options?.imageData && { imageData: options.imageData }),
  };
}

/**
 * Creates a model message with a final answer.
 */
export function createFinalAnswerMessage(
  answer: string,
  options?: {
    reasoning?: string;
  }
): ModelChatMessage {
  return {
    entity: ChatMessageEntity.MODEL,
    action: 'final',
    answer,
    isFinalAnswer: true,
    reasoning: options?.reasoning ? [options.reasoning] : undefined,
  };
}

// ============================================================================
// Mock ConfigurableAgentArgs
// ============================================================================

/**
 * Creates mock ConfigurableAgentArgs for testing.
 */
export function createMockAgentArgs(overrides?: Partial<ConfigurableAgentArgs>): ConfigurableAgentArgs {
  return {
    query: 'Test query',
    reasoning: 'Test reasoning',
    ...overrides,
  };
}

// ============================================================================
// Mock AgentSession Factory
// ============================================================================

/**
 * Creates a minimal mock AgentSession for testing.
 */
export function createMockAgentSession(overrides?: Partial<AgentSession>): AgentSession {
  return {
    agentName: 'test_agent',
    sessionId: crypto.randomUUID(),
    status: 'running',
    startTime: new Date(),
    messages: [],
    nestedSessions: [],
    tools: [],
    ...overrides,
  };
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Asserts that a specific tool was called in the messages.
 */
export function assertToolCalled(
  messages: ChatMessage[],
  toolName: string,
  times?: number
): void {
  const toolCalls = messages.filter(
    (m) => m.entity === ChatMessageEntity.MODEL && (m as ModelChatMessage).action === 'tool' && (m as ModelChatMessage).toolName === toolName
  );

  if (times !== undefined) {
    if (toolCalls.length !== times) {
      throw new Error(`Expected tool "${toolName}" to be called ${times} times, but was called ${toolCalls.length} times`);
    }
  } else if (toolCalls.length === 0) {
    throw new Error(`Expected tool "${toolName}" to be called at least once`);
  }
}

/**
 * Asserts that a final answer was provided.
 */
export function assertFinalAnswer(
  messages: ChatMessage[],
  contains?: string
): void {
  const finalAnswer = messages.find(
    (m) => m.entity === ChatMessageEntity.MODEL && (m as ModelChatMessage).action === 'final'
  ) as ModelChatMessage | undefined;

  if (!finalAnswer) {
    throw new Error('Expected a final answer message');
  }

  if (contains && !finalAnswer.answer?.includes(contains)) {
    throw new Error(`Expected final answer to contain "${contains}", but got: ${finalAnswer.answer}`);
  }
}

/**
 * Asserts that a tool result contains specific content.
 */
export function assertToolResult(
  messages: ChatMessage[],
  toolName: string,
  options?: {
    isError?: boolean;
    contains?: string;
  }
): void {
  const toolResults = messages.filter(
    (m) => m.entity === ChatMessageEntity.TOOL_RESULT && (m as ToolResultMessage).toolName === toolName
  ) as ToolResultMessage[];

  if (toolResults.length === 0) {
    throw new Error(`Expected a tool result for "${toolName}"`);
  }

  const lastResult = toolResults[toolResults.length - 1];

  if (options?.isError !== undefined && lastResult.isError !== options.isError) {
    throw new Error(`Expected tool result isError to be ${options.isError}, but got ${lastResult.isError}`);
  }

  if (options?.contains && !lastResult.resultText?.includes(options.contains)) {
    throw new Error(`Expected tool result to contain "${options.contains}", but got: ${lastResult.resultText}`);
  }
}

/**
 * Asserts that the result indicates a successful execution.
 */
export function assertSuccessResult(result: ConfigurableAgentResult): void {
  if (!result.success) {
    throw new Error(`Expected success result, but got error: ${result.error}`);
  }
}

/**
 * Asserts that the result indicates an error.
 */
export function assertErrorResult(
  result: ConfigurableAgentResult,
  contains?: string
): void {
  if (result.success) {
    throw new Error(`Expected error result, but got success: ${result.output}`);
  }

  if (contains && !result.error?.includes(contains)) {
    throw new Error(`Expected error to contain "${contains}", but got: ${result.error}`);
  }
}

/**
 * Asserts the termination reason.
 */
export function assertTerminationReason(
  result: ConfigurableAgentResult,
  expected: string
): void {
  if (result.terminationReason !== expected) {
    throw new Error(`Expected termination reason "${expected}", but got: ${result.terminationReason}`);
  }
}

// ============================================================================
// Wait Utilities
// ============================================================================

/**
 * Creates a promise that resolves after a delay.
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates an abort controller with automatic cleanup.
 */
export function createTestAbortController(): {
  controller: AbortController;
  signal: AbortSignal;
  abort: () => void;
} {
  const controller = new AbortController();
  return {
    controller,
    signal: controller.signal,
    abort: () => controller.abort(),
  };
}
