// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Shared test utilities for AI Chat UI component tests.
 * Provides mock factories, DOM helpers, and common test fixtures.
 */

import {raf, doubleRaf} from '../../../../testing/DOMHelpers.js';
import {ChatMessageEntity, State} from '../../models/ChatTypes.js';
import type {
  ChatMessage,
  UserChatMessage,
  ModelChatMessage,
  ToolResultMessage as ChatToolResultMessage,
  AgentSessionMessage,
  ImageInputData,
} from '../../models/ChatTypes.js';
import type {
  AgentSession,
  AgentMessage,
  ToolCallMessage,
  ToolResultMessage,
} from '../../agent_framework/AgentSessionTypes.js';

// Re-export for convenience
export {raf, doubleRaf};
export {ChatMessageEntity, State};

// ============================================================================
// Mock Storage
// ============================================================================

/**
 * Creates a mock localStorage implementation for testing.
 */
export function createMockStorage(): Map<string, string> & Storage {
  const storage = new Map<string, string>();

  return Object.assign(storage, {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => { storage.clear(); },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() { return storage.size; },
  });
}

/**
 * Installs mock localStorage on window. Returns cleanup function.
 */
export function installMockLocalStorage(): { storage: Map<string, string>, restore: () => void } {
  const originalLocalStorage = window.localStorage;
  const mockStorage = createMockStorage();

  Object.defineProperty(window, 'localStorage', {
    value: mockStorage,
    writable: true,
    configurable: true,
  });

  return {
    storage: mockStorage,
    restore: () => {
      Object.defineProperty(window, 'localStorage', {
        value: originalLocalStorage,
        writable: true,
        configurable: true,
      });
    },
  };
}

// ============================================================================
// Mock Message Factories
// ============================================================================

let messageIdCounter = 0;

/**
 * Creates a mock user message.
 */
export function createUserMessage(text: string, options?: {
  imageInput?: ImageInputData;
  error?: string;
}): UserChatMessage {
  return {
    entity: ChatMessageEntity.USER,
    text,
    imageInput: options?.imageInput,
    error: options?.error,
  };
}

/**
 * Creates a mock model message (tool call).
 */
export function createModelToolMessage(toolName: string, options?: {
  toolArgs?: Record<string, unknown>;
  toolCallId?: string;
  error?: string;
}): ModelChatMessage {
  return {
    entity: ChatMessageEntity.MODEL,
    action: 'tool',
    toolName,
    toolArgs: options?.toolArgs ?? {},
    toolCallId: options?.toolCallId ?? `tool-call-${++messageIdCounter}`,
    isFinalAnswer: false,
    error: options?.error,
  };
}

/**
 * Creates a mock model message (final answer).
 */
export function createModelFinalMessage(answer: string, options?: {
  reasoning?: string[];
  error?: string;
}): ModelChatMessage {
  return {
    entity: ChatMessageEntity.MODEL,
    action: 'final',
    answer,
    isFinalAnswer: true,
    reasoning: options?.reasoning,
    error: options?.error,
  };
}

/**
 * Creates a mock tool result message.
 */
export function createToolResultMessage(toolName: string, resultText: string, options?: {
  isError?: boolean;
  toolCallId?: string;
  resultData?: unknown;
  imageData?: string;
  summary?: string;
}): ChatToolResultMessage {
  return {
    entity: ChatMessageEntity.TOOL_RESULT,
    toolName,
    resultText,
    isError: options?.isError ?? false,
    toolCallId: options?.toolCallId,
    resultData: options?.resultData,
    imageData: options?.imageData,
    summary: options?.summary,
  };
}

/**
 * Creates a mock agent session message.
 */
export function createAgentSessionMessage(session: AgentSession, options?: {
  triggerMessageId?: string;
  summary?: string;
}): AgentSessionMessage {
  return {
    entity: ChatMessageEntity.AGENT_SESSION,
    agentSession: session,
    triggerMessageId: options?.triggerMessageId,
    summary: options?.summary,
  };
}

// ============================================================================
// Mock Agent Session Factories
// ============================================================================

let sessionIdCounter = 0;

/**
 * Creates a mock agent session.
 */
export function createAgentSession(options?: Partial<AgentSession>): AgentSession {
  const sessionId = options?.sessionId ?? `session-${++sessionIdCounter}`;

  return {
    agentName: options?.agentName ?? 'test_agent',
    sessionId,
    status: options?.status ?? 'running',
    startTime: options?.startTime ?? new Date(),
    endTime: options?.endTime,
    messages: options?.messages ?? [],
    nestedSessions: options?.nestedSessions ?? [],
    tools: options?.tools ?? [],
    config: options?.config,
    agentQuery: options?.agentQuery,
    agentReasoning: options?.agentReasoning,
    iterationCount: options?.iterationCount,
    maxIterations: options?.maxIterations,
  };
}

/**
 * Creates a mock tool call message for agent sessions.
 */
export function createAgentToolCall(toolName: string, options?: {
  id?: string;
  toolArgs?: Record<string, unknown>;
  reasoning?: string;
}): AgentMessage {
  const id = options?.id ?? `tc-${++messageIdCounter}`;
  return {
    id,
    timestamp: new Date(),
    type: 'tool_call',
    content: {
      type: 'tool_call',
      toolName,
      toolArgs: options?.toolArgs ?? {},
      toolCallId: id,
      reasoning: options?.reasoning,
    } as ToolCallMessage,
  };
}

/**
 * Creates a mock tool result message for agent sessions.
 */
export function createAgentToolResult(toolCallId: string, toolName: string, options?: {
  success?: boolean;
  result?: unknown;
  error?: string;
  duration?: number;
}): AgentMessage {
  return {
    id: `${toolCallId}-result`,
    timestamp: new Date(),
    type: 'tool_result',
    content: {
      type: 'tool_result',
      toolCallId,
      toolName,
      success: options?.success ?? true,
      result: options?.result ?? { ok: true },
      error: options?.error,
      duration: options?.duration,
    } as ToolResultMessage,
  };
}

/**
 * Creates a mock handoff message for agent sessions.
 */
export function createAgentHandoff(targetAgent: string, options?: {
  id?: string;
  reason?: string;
  context?: Record<string, unknown>;
  nestedSessionId?: string;
}): AgentMessage {
  return {
    id: options?.id ?? `handoff-${++messageIdCounter}`,
    timestamp: new Date(),
    type: 'handoff',
    content: {
      type: 'handoff',
      targetAgent,
      reason: options?.reason ?? 'Handing off to specialized agent',
      context: options?.context ?? {},
      nestedSessionId: options?.nestedSessionId ?? `nested-${++sessionIdCounter}`,
    },
  };
}

/**
 * Creates a mock final answer message for agent sessions.
 */
export function createAgentFinalAnswer(answer: string, options?: {
  id?: string;
  summary?: string;
}): AgentMessage {
  return {
    id: options?.id ?? `final-${++messageIdCounter}`,
    timestamp: new Date(),
    type: 'final_answer',
    content: {
      type: 'final_answer',
      answer,
      summary: options?.summary,
    },
  };
}

// ============================================================================
// DOM Test Helpers
// ============================================================================

/**
 * Queries an element within a component's shadow DOM.
 * Throws if not found.
 */
export function queryShadow<T extends Element>(
  component: HTMLElement,
  selector: string,
): T {
  const shadowRoot = component.shadowRoot;
  if (!shadowRoot) {
    throw new Error(`Component has no shadow root`);
  }
  const element = shadowRoot.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }
  return element;
}

/**
 * Queries all elements within a component's shadow DOM.
 */
export function queryShadowAll<T extends Element>(
  component: HTMLElement,
  selector: string,
): NodeListOf<T> {
  const shadowRoot = component.shadowRoot;
  if (!shadowRoot) {
    throw new Error(`Component has no shadow root`);
  }
  return shadowRoot.querySelectorAll<T>(selector);
}

/**
 * Safely queries an element (returns null if not found).
 */
export function queryShadowSafe<T extends Element>(
  component: HTMLElement,
  selector: string,
): T | null {
  return component.shadowRoot?.querySelector<T>(selector) ?? null;
}

/**
 * Gets text content from shadow DOM element.
 */
export function getShadowText(component: HTMLElement, selector: string): string {
  const element = queryShadowSafe(component, selector);
  return element?.textContent?.trim() ?? '';
}

/**
 * Checks if an element exists in shadow DOM.
 */
export function shadowHas(component: HTMLElement, selector: string): boolean {
  return queryShadowSafe(component, selector) !== null;
}

/**
 * Creates an element, appends to body, and returns cleanup function.
 */
export function renderToBody<T extends HTMLElement>(
  tagName: string,
): { element: T; cleanup: () => void } {
  const element = document.createElement(tagName) as T;
  document.body.appendChild(element);

  return {
    element,
    cleanup: () => {
      if (document.body.contains(element)) {
        document.body.removeChild(element);
      }
    },
  };
}

/**
 * Waits for an element to appear in shadow DOM.
 */
export async function waitForShadowElement(
  component: HTMLElement,
  selector: string,
  timeout = 1000,
): Promise<Element> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const element = queryShadowSafe(component, selector);
    if (element) {
      return element;
    }
    await raf();
  }

  throw new Error(`Timeout waiting for element: ${selector}`);
}

// ============================================================================
// Event Dispatch Helpers
// ============================================================================

/**
 * Dispatches a click event on an element.
 */
export function click(element: Element): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/**
 * Dispatches an input event on an input/textarea element.
 */
export function typeText(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
}

/**
 * Dispatches a keydown event.
 */
export function keydown(element: Element, key: string, options?: Partial<KeyboardEventInit>): void {
  element.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  }));
}

/**
 * Dispatches Enter key press.
 */
export function pressEnter(element: Element, options?: { shiftKey?: boolean }): void {
  keydown(element, 'Enter', { shiftKey: options?.shiftKey });
}

/**
 * Dispatches Escape key press.
 */
export function pressEscape(element: Element): void {
  keydown(element, 'Escape');
}

/**
 * Dispatches scroll event.
 */
export function scroll(element: Element): void {
  element.dispatchEvent(new Event('scroll'));
}

/**
 * Listens for a custom event and returns a promise that resolves with the event.
 */
export function waitForEvent<T extends Event>(
  element: Element,
  eventName: string,
  timeout = 1000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);

    element.addEventListener(eventName, (event) => {
      clearTimeout(timer);
      resolve(event as T);
    }, { once: true });
  });
}

// ============================================================================
// ChatView Test Helpers
// ============================================================================

/**
 * Props interface for ChatView component.
 */
export interface ChatViewData {
  messages: ChatMessage[];
  state: 'idle' | 'loading' | 'error';
  isTextInputEmpty: boolean;
  onSendMessage: (text: string, imageInput?: ImageInputData | null) => void;
  onPromptSelected: (prompt: string, agentType?: string) => void;
  selectedAgent?: string;
  selectedModel?: string;
  modelOptions?: Array<{ value: string; label: string }>;
  onModelChanged?: (model: string) => void;
  isProcessing?: boolean;
}

/**
 * Creates default ChatView data props.
 */
export function createChatViewData(overrides?: Partial<ChatViewData>): ChatViewData {
  return {
    messages: overrides?.messages ?? [],
    state: overrides?.state ?? 'idle',
    isTextInputEmpty: overrides?.isTextInputEmpty ?? true,
    onSendMessage: overrides?.onSendMessage ?? (() => {}),
    onPromptSelected: overrides?.onPromptSelected ?? (() => {}),
    selectedAgent: overrides?.selectedAgent,
    selectedModel: overrides?.selectedModel,
    modelOptions: overrides?.modelOptions,
    onModelChanged: overrides?.onModelChanged,
    isProcessing: overrides?.isProcessing,
  };
}

/**
 * Sets up a ChatView component with data.
 */
export async function setupChatView(data?: Partial<ChatViewData>): Promise<{
  view: HTMLElement;
  cleanup: () => void;
  updateData: (newData: Partial<ChatViewData>) => Promise<void>;
}> {
  const { element: view, cleanup } = renderToBody<HTMLElement>('devtools-chat-view');

  const fullData = createChatViewData(data);
  (view as any).data = fullData;
  await raf();

  return {
    view,
    cleanup,
    updateData: async (newData: Partial<ChatViewData>) => {
      (view as any).data = createChatViewData({ ...fullData, ...newData });
      await raf();
    },
  };
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Asserts that an element has a specific class.
 */
export function assertHasClass(element: Element, className: string): void {
  assert.isTrue(
    element.classList.contains(className),
    `Expected element to have class "${className}", but it has: ${element.className}`,
  );
}

/**
 * Asserts that an element does not have a specific class.
 */
export function assertNotHasClass(element: Element, className: string): void {
  assert.isFalse(
    element.classList.contains(className),
    `Expected element not to have class "${className}"`,
  );
}

/**
 * Asserts that shadow DOM contains text.
 */
export function assertShadowContainsText(component: HTMLElement, text: string): void {
  const innerHTML = component.shadowRoot?.innerHTML ?? '';
  assert.include(
    innerHTML.toLowerCase(),
    text.toLowerCase(),
    `Expected shadow DOM to contain "${text}"`,
  );
}

/**
 * Asserts that shadow DOM does not contain text.
 */
export function assertShadowNotContainsText(component: HTMLElement, text: string): void {
  const innerHTML = component.shadowRoot?.innerHTML ?? '';
  assert.notInclude(
    innerHTML.toLowerCase(),
    text.toLowerCase(),
    `Expected shadow DOM not to contain "${text}"`,
  );
}

/**
 * Asserts element count in shadow DOM.
 */
export function assertShadowElementCount(
  component: HTMLElement,
  selector: string,
  expectedCount: number,
): void {
  const elements = queryShadowAll(component, selector);
  assert.strictEqual(
    elements.length,
    expectedCount,
    `Expected ${expectedCount} elements matching "${selector}", found ${elements.length}`,
  );
}

// ============================================================================
// Test Fixture Cleanup
// ============================================================================

/**
 * Cleanup manager for test fixtures.
 */
export class TestCleanup {
  private cleanupFns: Array<() => void> = [];

  add(fn: () => void): void {
    this.cleanupFns.push(fn);
  }

  runAll(): void {
    for (const fn of this.cleanupFns.reverse()) {
      try {
        fn();
      } catch (e) {
        console.warn('Cleanup function failed:', e);
      }
    }
    this.cleanupFns = [];
  }
}

/**
 * Creates a test cleanup manager that automatically runs in afterEach.
 */
export function useTestCleanup(): TestCleanup {
  const cleanup = new TestCleanup();

  afterEach(() => {
    cleanup.runAll();
  });

  return cleanup;
}

// ============================================================================
// Counter Reset (for test isolation)
// ============================================================================

/**
 * Resets all internal counters. Call in beforeEach for test isolation.
 */
export function resetTestCounters(): void {
  messageIdCounter = 0;
  sessionIdCounter = 0;
}
