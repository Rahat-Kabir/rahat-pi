import { describe, it, expect } from 'vitest';
import { canonicalJson, payloadHash, proposeAction, approveAction, editAction, canExecute } from '../src/executor/actions.js';
import { MemoryIndex } from '../src/extensions/memory.js';
import { assertAllowedTool, toolPolicy } from '../src/policy/index.js';
import { nextDailyOccurrence, occurrenceId, dueOccurrence } from '../src/extensions/routines.js';
import { FixtureCalendar, GoogleCalendar } from '../src/extensions/calendar.js';
import { App } from '../src/harness/app.js';
import { FakeSender } from '../src/executor/fake-sender.js';
import { configFromEnv } from '../src/config.js';
import { temporaryData, offlineConfig, toolMessage, testOwnerName, testUtcOffsetMs } from './helpers.js';
import type { Routine } from '../src/harness/state.js';

describe('memory FTS5 and provenance', () => {
  it('searches facts, preserves source, escapes FTS syntax, and forgets stale facts', () => {
    const memoryIndex = new MemoryIndex();
    const memory = { id: 'fact', content: 'Rahat prefers tea without sugar', source: 'email:untrusted', createdAt: 1, trust: 'data' as const };
    try {
      expect(memoryIndex.search({ fact: memory }, 'tea')[0]).toEqual(memory);
      expect(memoryIndex.search({ fact: memory }, '"tea" OR (bad:*')).toEqual([memory]);
      expect(memoryIndex.search({}, 'tea')).toEqual([]);
      expect(memoryIndex.search({ fact: memory }, '**')).toEqual([]);
    } finally {
      memoryIndex.close();
    }
  });
});
describe('action contracts', () => {
  const payload = { recipient: 'fixture:owner', body: 'Hi' };
  it('canonicalizes nested JSON and hashes key order identically', () => {
    expect(canonicalJson({ second: [2, { z: 1, a: true }], first: null })).toBe('{"first":null,"second":[2,{"a":true,"z":1}]}');
    expect(payloadHash(payload)).toBe(payloadHash({ body: 'Hi', recipient: 'fixture:owner' }));
    expect(() => canonicalJson({ invalid: undefined })).toThrow();
    expect(() => canonicalJson(NaN)).toThrow();
  });
  it('requires approval, binds exact payload, expires at 24 hours, and invalidates edits', () => {
    const action = proposeAction('action', payload, 1000);
    expect(canExecute(action, 1000)).toBe(false);
    approveAction(action, 2000, testOwnerName);
    expect(canExecute(action, 2000)).toBe(true);
    expect(canExecute(action, 86401000)).toBe(false);
    action.payload.body = 'Different';
    expect(canExecute(action, 2000)).toBe(false);
    editAction(action, { ...payload, body: 'Edited' }, 3000);
    expect(action.status).toBe('proposed');
    expect(action.approvedHash).toBeNull();
    approveAction(action, 3001, testOwnerName);
    expect(canExecute(action, 3001)).toBe(true);
    action.status = 'executing';
    expect(() => editAction(action, payload, 4000)).toThrow();
    expect(() => approveAction(action, 4000, testOwnerName)).toThrow();
  });
  it('rejects expired or malformed proposals', () => {
    expect(() => approveAction(proposeAction('a', payload, 0), 86400000, testOwnerName)).toThrow('expired');
    expect(() => proposeAction('a', { recipient: '', body: 'Hi' }, 0)).toThrow();
  });
  it('fake provider returns the original receipt and rejects key reuse with changed payload', () => {
    const temporaryStorage = temporaryData();
    const sender = new FakeSender(`${temporaryStorage.dataDir}/provider.sqlite`);
    try {
      const receipt = sender.send('one', payload);
      expect(sender.send('one', payload)).toBe(receipt);
      expect(sender.rows()).toHaveLength(1);
      expect(() => sender.send('one', { ...payload, body: 'changed' })).toThrow('mismatch');
    } finally {
      sender.close();
      temporaryStorage.cleanup();
    }
  });
});
describe('policy and scheduling', () => {
  it('denies approval, direct sends, shell, browser, and unknown tools', () => {
    for (const toolName of ['approve', 'send_message', 'bash', 'browser', '__proto__']) {
      expect(() => assertAllowedTool(toolName)).toThrow('denied');
    }
    for (const toolName of Object.keys(toolPolicy)) {
      expect(() => assertAllowedTool(toolName)).not.toThrow();
    }
    expect(toolPolicy.propose_send_message).toBe('proposal');
  });
  it('computes fixed-offset daily occurrences and stable ids', () => {
    const now = Date.parse('2026-10-24T07:59:00+06:00');
    const nextOccurrenceTime = nextDailyOccurrence('08:00', now, testUtcOffsetMs);
    expect(nextOccurrenceTime).toBe(Date.parse('2026-10-24T08:00:00+06:00'));
    expect(nextDailyOccurrence('08:00', nextOccurrenceTime, testUtcOffsetMs)).toBe(nextOccurrenceTime + 86400000);
    expect(occurrenceId('daily', nextOccurrenceTime)).toBe(`daily:${nextOccurrenceTime}`);
    expect(() => nextDailyOccurrence('24:00', now, testUtcOffsetMs)).toThrow();
  });
  it('skips missed work or catches up only the latest occurrence', () => {
    const routine = { nextRunAt: 1000, missedRunPolicy: 'catchUpOnce' } as Routine;
    expect(dueOccurrence(routine, 999)).toBeNull();
    expect(dueOccurrence(routine, 1000 + 3 * 86400000 + 10000)).toBe(1000 + 3 * 86400000);
    routine.missedRunPolicy = 'skip';
    expect(dueOccurrence(routine, 61000)).toBeNull();
    expect(dueOccurrence(routine, 1000)).toBe(1000);
  });
  it('reads fixture events and fails clearly for unconfigured OAuth', async () => {
    const fixtureCalendar = new FixtureCalendar();
    expect(await fixtureCalendar.listEvents('2026-10-24T00:00:00Z', '2026-10-25T00:00:00Z')).toHaveLength(1);
    await expect(fixtureCalendar.listEvents('bad', 'bad')).rejects.toThrow('Invalid');
    await expect(new GoogleCalendar().listEvents('', '')).rejects.toThrow('not configured');
  });
});
describe('offline Pi integration', () => {
  it('runs real tools, prevents a direct send, and forgets a fact', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      await app.dispatch({ name: 'chat', message: toolMessage('memory_write', { content: 'Likes tea', source: 'owner:cli' }) });
      const state = await app.dispatch({ name: 'state' }) as { memories: Record<string, unknown> };
      const memoryId = Object.keys(state.memories)[0];
      await app.dispatch({ name: 'chat', message: toolMessage('memory_forget', { id: memoryId }) });
      expect((await app.dispatch({ name: 'state' }) as typeof state).memories).toEqual({});
      const response = await app.dispatch({ name: 'chat', message: toolMessage('send_message', { recipient: 'outside', body: 'bypass' }) });
      expect(JSON.stringify(response)).toMatch(/not|unknown|offered|available/i);
      expect(await app.dispatch({ name: 'outbox' })).toEqual([]);
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });
  it('rejects token and daily reservation overages before a model request', async () => {
    for (const configOverrides of [{ RAHAT_PI_MAX_RUN_TOKENS: '1' }, { RAHAT_PI_DAILY_USD_CAP: '0.000000001' }] as Record<string, string>[]) {
      const temporaryStorage = temporaryData();
      const config = offlineConfig(temporaryStorage.dataDir, configOverrides);
      const app = await App.open(config);
      try {
        await expect(app.dispatch({ name: 'chat', message: 'hi' })).rejects.toThrow();
      } finally {
        await app.close();
        temporaryStorage.cleanup();
      }
    }
  });
  it('rejects invalid numeric limits', () => {
    expect(() => configFromEnv({ RAHAT_PI_MAX_RUN_MS: '-1' })).toThrow();
  });
});

describe('limits and cancellation', () => {
  it('blocks the second tool call in a run before its local write', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_MAX_TOOL_CALLS: '1' }));
    try {
      await app.dispatch({ name: 'chat', message: '/tools ' + JSON.stringify([
        { name: 'memory_write', arguments: { content: 'first fact', source: 'owner:cli' } },
        { name: 'memory_write', arguments: { content: 'second fact', source: 'owner:cli' } },
      ]) });
      const state = await app.dispatch({ name: 'state' }) as { memories: Record<string, { content: string }> };
      expect(Object.values(state.memories).map(memory => memory.content)).toEqual(['first fact']);
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });
  it('refuses an elapsed run deadline before dispatch', async () => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_MAX_RUN_MS: '500' });
    let clockTime = 0;
    config.now = () => {
      clockTime += 1000;
      return clockTime;
    };
    const app = await App.open(config);
    try {
      await expect(app.dispatch({ name: 'chat', message: 'hi' })).rejects.toThrow();
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });
});
