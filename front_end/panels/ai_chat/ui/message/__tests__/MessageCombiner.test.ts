// Copyright 2025 The Chromium Authors.

import {combineMessages} from '../MessageCombiner.js';
// Local minimal enum to avoid importing TypeScript enums from ChatTypes in strip-only mode
const ChatMessageEntity = {
  USER: 'user',
  MODEL: 'model',
  TOOL_RESULT: 'tool_result',
  AGENT_SESSION: 'agent_session',
} as const;
type ChatMessage = any;

describe('MessageCombiner', () => {
  describe('Basic Combining', () => {
    it('combines adjacent tool call and result by toolCallId', () => {
      const messages: ChatMessage[] = [
        { entity: ChatMessageEntity.USER, text: 'Go' } as any,
        { entity: ChatMessageEntity.MODEL, action: 'tool', toolName: 'fetch', toolCallId: 'id-1', isFinalAnswer: false } as any,
        { entity: ChatMessageEntity.TOOL_RESULT, toolName: 'fetch', toolCallId: 'id-1', resultText: '{"ok":true}', isError: false } as any,
        { entity: ChatMessageEntity.MODEL, action: 'final', answer: 'Done', isFinalAnswer: true } as any,
      ];

      const combined = combineMessages(messages);
      assert.lengthOf(combined, 3);
      assert.strictEqual((combined[1] as any).combined, true);
      assert.strictEqual((combined[1] as any).resultText, '{"ok":true}');
    });

    it('combines tool call with result by toolName when toolCallId is missing', () => {
      const messages: ChatMessage[] = [
        { entity: ChatMessageEntity.USER, text: 'Go' } as any,
        { entity: ChatMessageEntity.MODEL, action: 'tool', toolName: 'scan', isFinalAnswer: false } as any,
        { entity: ChatMessageEntity.TOOL_RESULT, toolName: 'scan', resultText: 'scanned', isError: false } as any,
      ];

      const combined = combineMessages(messages);
      assert.lengthOf(combined, 2);
      assert.strictEqual((combined[1] as any).combined, true);
    });

    it('preserves order of combined messages', () => {
      const messages: ChatMessage[] = [
        { entity: ChatMessageEntity.USER, text: 'First' } as any,
        { entity: ChatMessageEntity.MODEL, action: 'tool', toolName: 'a', toolCallId: 'a1', isFinalAnswer: false } as any,
        { entity: ChatMessageEntity.TOOL_RESULT, toolName: 'a', toolCallId: 'a1', resultText: 'result-a', isError: false } as any,
        { entity: ChatMessageEntity.MODEL, action: 'tool', toolName: 'b', toolCallId: 'b1', isFinalAnswer: false } as any,
        { entity: ChatMessageEntity.TOOL_RESULT, toolName: 'b', toolCallId: 'b1', resultText: 'result-b', isError: false } as any,
        { entity: ChatMessageEntity.MODEL, action: 'final', answer: 'Done', isFinalAnswer: true } as any,
      ];

      const combined = combineMessages(messages);
      assert.lengthOf(combined, 4);
      assert.strictEqual((combined[0] as any).entity, 'user');
      assert.strictEqual((combined[1] as any).toolName, 'a');
      assert.strictEqual((combined[2] as any).toolName, 'b');
      assert.strictEqual((combined[3] as any).action, 'final');
    });
  });

  describe('Multiple Tool Calls', () => {
    it('handles multiple tool calls combined correctly', () => {
      const messages: ChatMessage[] = [
        { entity: ChatMessageEntity.USER, text: 'Go' } as any,
        { entity: ChatMessageEntity.MODEL, action: 'tool', toolName: 'fetch', toolCallId: 'id-1', isFinalAnswer: false } as any,
        { entity: ChatMessageEntity.TOOL_RESULT, toolName: 'fetch', toolCallId: 'id-1', resultText: 'res1', isError: false } as any,
        { entity: ChatMessageEntity.MODEL, action: 'tool', toolName: 'parse', toolCallId: 'id-2', isFinalAnswer: false } as any,
        { entity: ChatMessageEntity.TOOL_RESULT, toolName: 'parse', toolCallId: 'id-2', resultText: 'res2', isError: false } as any,
        { entity: ChatMessageEntity.MODEL, action: 'tool', toolName: 'format', toolCallId: 'id-3', isFinalAnswer: false } as any,
        { entity: ChatMessageEntity.TOOL_RESULT, toolName: 'format', toolCallId: 'id-3', resultText: 'res3', isError: false } as any,
      ];

      const combined = combineMessages(messages);
      assert.lengthOf(combined, 4); // user + 3 combined tool calls

      // All tool calls should be combined
      assert.isTrue((combined[1] as any).combined);
      assert.isTrue((combined[2] as any).combined);
      assert.isTrue((combined[3] as any).combined);
    });
  });

  describe('Orphaned Tool Results', () => {
    it('marks orphaned tool results', () => {
      const messages: ChatMessage[] = [
        { entity: ChatMessageEntity.TOOL_RESULT, toolName: 'scan', resultText: 'x', isError: false } as any,
      ];
      const combined = combineMessages(messages);
      assert.lengthOf(combined, 1);
      assert.isTrue((combined[0] as any).orphaned);
    });

    it('marks tool result as orphaned when previous message is not matching tool call', () => {
      const messages: ChatMessage[] = [
        { entity: ChatMessageEntity.USER, text: 'Go' } as any,
        { entity: ChatMessageEntity.MODEL, action: 'tool', toolName: 'fetch', toolCallId: 'id-1', isFinalAnswer: false } as any,
        { entity: ChatMessageEntity.TOOL_RESULT, toolName: 'different', toolCallId: 'id-2', resultText: 'orphan', isError: false } as any,
      ];

      const combined = combineMessages(messages);
      // user + uncombined fetch call + orphaned result
      assert.lengthOf(combined, 3);
      assert.isTrue((combined[2] as any).orphaned);
    });

    it('renders orphaned tool result when tool call is missing', () => {
      const messages: ChatMessage[] = [
        { entity: ChatMessageEntity.USER, text: 'Go' } as any,
        { entity: ChatMessageEntity.TOOL_RESULT, toolName: 'missing_tool', resultText: 'result', isError: false } as any,
        { entity: ChatMessageEntity.MODEL, action: 'final', answer: 'Done', isFinalAnswer: true } as any,
      ];

      const combined = combineMessages(messages);
      assert.lengthOf(combined, 3);
      assert.isTrue((combined[1] as any).orphaned);
    });
  });

  describe('Mismatched IDs', () => {
    it('handles mismatched toolCallIds by not combining', () => {
      const messages: ChatMessage[] = [
        { entity: ChatMessageEntity.MODEL, action: 'tool', toolName: 'fetch', toolCallId: 'id-A', isFinalAnswer: false } as any,
        { entity: ChatMessageEntity.TOOL_RESULT, toolName: 'fetch', toolCallId: 'id-B', resultText: 'wrong', isError: false } as any,
      ];

      const combined = combineMessages(messages);
      // Tool call not combined, result orphaned
      assert.lengthOf(combined, 2);
      assert.isUndefined((combined[0] as any).combined);
      assert.isTrue((combined[1] as any).orphaned);
    });
  });

  describe('Agent Lane Filtering', () => {
    it('hides model tool-call and its result when marked agent-lane', () => {
      const toolCallId = 'tc-123';
      const messages: ChatMessage[] = [
        { entity: ChatMessageEntity.USER, text: 'run agent' } as any,
        // Model tool call that will be managed by the agent session
        { entity: ChatMessageEntity.MODEL, action: 'tool', toolName: 'fetch', toolCallId, isFinalAnswer: false, uiLane: 'agent' } as any,
        { entity: ChatMessageEntity.TOOL_RESULT, toolName: 'fetch', toolCallId, resultText: '{"ok":true}', isError: false, uiLane: 'agent' } as any,
        { entity: ChatMessageEntity.AGENT_SESSION, agentSession: { sessionId: 's1', agentName: 'agent', status: 'running', startTime: new Date(), messages: [], nestedSessions: [] } } as any,
      ];

      const combined = combineMessages(messages);
      // Expect: user + agent_session only (model tool+result removed via lane)
      assert.lengthOf(combined, 2);
      assert.strictEqual((combined[0] as any).entity, 'user');
      assert.strictEqual((combined[1] as any).entity, 'agent_session');
    });

    it('hides agent-lane tool_result even if it arrives before model tool-call', () => {
      const toolCallId = 'tc-outoforder';
      const messages: ChatMessage[] = [
        { entity: ChatMessageEntity.USER, text: 'go' } as any,
        // Agent-managed tool result first
        { entity: ChatMessageEntity.TOOL_RESULT, toolName: 'fetch', toolCallId, resultText: '{"ok":1}', isError: false, uiLane: 'agent' } as any,
        // Model tool call later
        { entity: ChatMessageEntity.MODEL, action: 'tool', toolName: 'fetch', toolCallId, isFinalAnswer: false } as any,
      ];

      const combined = combineMessages(messages);
      // Expect: user only (both the agent-lane result and matching model call removed)
      assert.lengthOf(combined, 1);
      assert.strictEqual((combined[0] as any).entity, 'user');
    });

    it('shows chat-lane tool result while hiding agent-lane ones', () => {
      const messages: ChatMessage[] = [
        { entity: ChatMessageEntity.USER, text: 'go' } as any,
        { entity: ChatMessageEntity.TOOL_RESULT, toolName: 'hidden', resultText: 'hidden', isError: false, uiLane: 'agent' } as any,
        { entity: ChatMessageEntity.TOOL_RESULT, toolName: 'visible', resultText: 'visible', isError: false, uiLane: 'chat' } as any,
      ];

      const combined = combineMessages(messages);
      assert.lengthOf(combined, 2);
      assert.strictEqual((combined[1] as any).toolName, 'visible');
    });
  });

  describe('Passthrough Messages', () => {
    it('passes through user messages unchanged', () => {
      const messages: ChatMessage[] = [
        { entity: ChatMessageEntity.USER, text: 'Hello' } as any,
        { entity: ChatMessageEntity.USER, text: 'World' } as any,
      ];

      const combined = combineMessages(messages);
      assert.lengthOf(combined, 2);
      assert.strictEqual((combined[0] as any).text, 'Hello');
      assert.strictEqual((combined[1] as any).text, 'World');
    });

    it('passes through final model answers unchanged', () => {
      const messages: ChatMessage[] = [
        { entity: ChatMessageEntity.MODEL, action: 'final', answer: 'Answer 1', isFinalAnswer: true } as any,
        { entity: ChatMessageEntity.MODEL, action: 'final', answer: 'Answer 2', isFinalAnswer: true } as any,
      ];

      const combined = combineMessages(messages);
      assert.lengthOf(combined, 2);
      assert.strictEqual((combined[0] as any).answer, 'Answer 1');
      assert.strictEqual((combined[1] as any).answer, 'Answer 2');
    });

    it('passes through agent session messages unchanged', () => {
      const messages: ChatMessage[] = [
        { entity: ChatMessageEntity.AGENT_SESSION, agentSession: { sessionId: 's1' } } as any,
      ];

      const combined = combineMessages(messages);
      assert.lengthOf(combined, 1);
      assert.strictEqual((combined[0] as any).agentSession.sessionId, 's1');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty message array', () => {
      const combined = combineMessages([]);
      assert.lengthOf(combined, 0);
    });

    it('handles running tool call without result', () => {
      const messages: ChatMessage[] = [
        { entity: ChatMessageEntity.USER, text: 'Go' } as any,
        { entity: ChatMessageEntity.MODEL, action: 'tool', toolName: 'fetch', toolCallId: 'id-1', isFinalAnswer: false } as any,
        // No result yet
      ];

      const combined = combineMessages(messages);
      assert.lengthOf(combined, 2);
      assert.isUndefined((combined[1] as any).combined);
    });

    it('handles error tool result with isError flag', () => {
      const messages: ChatMessage[] = [
        { entity: ChatMessageEntity.MODEL, action: 'tool', toolName: 'fetch', toolCallId: 'id-1', isFinalAnswer: false } as any,
        { entity: ChatMessageEntity.TOOL_RESULT, toolName: 'fetch', toolCallId: 'id-1', resultText: 'Error!', isError: true } as any,
      ];

      const combined = combineMessages(messages);
      assert.lengthOf(combined, 1);
      assert.isTrue((combined[0] as any).combined);
      assert.isTrue((combined[0] as any).isError);
    });
  });
});
