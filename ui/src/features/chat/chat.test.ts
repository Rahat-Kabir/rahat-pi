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
    stats: {} as WebState['stats'],
    ...partial,
  };
}

describe('chat messages', () => {
  it('turns text and tool-call blocks into plain text', () => {
    expect(contentText('hello')).toBe('hello');
    expect(contentText([
      { type: 'text', text: 'Looking it up.' },
      { type: 'toolCall', name: 'memory_search', arguments: { query: 'tea' } },
    ])).toBe('Looking it up.\nTool: memory_search {\n  "query": "tea"\n}');
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
      { key: '1:0', role: 'user', text: 'Hi' },
      { key: '2:0', role: 'assistant', text: 'Hello' },
      { key: '2:1', role: 'tool', text: 'ok' },
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
