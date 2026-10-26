import { describe, expect, it } from 'vitest';
import type { WebState } from '@api';
import { contentText, liveAnswer, queuedText, runFailure, transcript } from './messages';
import { nextPendingMessage } from './pendingMessage';

function stateWith(partial: Partial<WebState>): WebState {
  return {
    entries: [],
    live: {},
    inbox: { items: [] },
    actions: [],
    subagents: [],
    memories: [],
    routines: [],
    stoppedTasks: [],
    stats: {} as WebState['stats'],
    ...partial,
  };
}

describe('chat messages', () => {
  it('keeps only readable text in the bubble and moves thinking and tool calls aside', () => {
    expect(contentText('hello')).toBe('hello');
    const state = stateWith({
      entries: [{ id: 1, kind: 'answer', model: [{ role: 'assistant', content: [
        { type: 'thinking', thinking: 'The owner asked about tea.', thinkingSignature: 'opaque-signature' },
        { type: 'thinking', thinking: '', redacted: true, thinkingSignature: 'encrypted' },
        { type: 'text', text: 'Looking it up.' },
        { type: 'toolCall', id: 'call-1', name: 'memory_search', arguments: { query: 'tea' } },
      ] }] }],
    });
    const [message] = transcript(state);
    expect(message.text).toBe('Looking it up.');
    expect(message.thinking).toBe('The owner asked about tea.');
    expect(message.toolCalls).toEqual([{ icon: '🔍', summary: 'Searched memory for "tea"', details: '{\n  "query": "tea"\n}' }]);
    expect(JSON.stringify(message)).not.toContain('signature');
  });

  it('keeps markup as text, never as HTML', () => {
    expect(contentText('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });

  it('lists every model message with a stable key and a display role', () => {
    const state = stateWith({
      entries: [
        { id: 1, kind: 'input', model: [{ role: 'user', content: 'Hi' }] },
        { id: 2, kind: 'answer', model: [{ role: 'assistant', content: 'Hello' }, { role: 'toolResult', content: 'ok' }] },
      ],
    });
    expect(transcript(state)).toEqual([
      { key: '1:0', role: 'user', text: 'Hi', thinking: '', toolCalls: [] },
      { key: '2:0', role: 'assistant', text: 'Hello', thinking: '', toolCalls: [] },
      { key: '2:1', role: 'tool', text: 'ok', thinking: '', toolCalls: [] },
    ]);
  });

  it('shows the live answer and the reason a run failed', () => {
    const state = stateWith({
      live: { generation: { message: { role: 'assistant', content: 'Partial', errorMessage: 'Budget cap reached' } } },
    });
    expect(liveAnswer(state)?.text).toBe('Partial');
    expect(runFailure(state)).toBe('Budget cap reached');
    expect(liveAnswer(stateWith({}))).toBeNull();
  });

  it('describes queued items', () => {
    expect(queuedText({ id: 1, mode: 'followUp', content: 'Next question' })).toBe('Next question');
    expect(queuedText({ id: 2, mode: 'write' })).toBe('Pending write');
  });
});

describe('pending message', () => {
  const ids = ['request-1', 'request-2'];
  const createRequestId = () => ids.shift()!;

  it('reuses the request ID when retrying the same message, and makes a new one otherwise', () => {
    const first = nextPendingMessage(undefined, 'hello', 'followUp', createRequestId);
    expect(first.requestId).toBe('request-1');
    expect(nextPendingMessage(first, 'hello', 'followUp', createRequestId)).toBe(first);
    expect(nextPendingMessage(first, 'hello', 'steer', createRequestId).requestId).toBe('request-2');
  });
});
