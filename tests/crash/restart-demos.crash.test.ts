import { describe, it, expect } from 'vitest';
import { cli, temporaryData, toolMessage, jsonOutput } from '../helpers.js';
import type { AppState, Action } from '../../src/harness/state.js';

const proposal = toolMessage('propose_send_message', { recipient: 'fixture:rahat', body: 'Approved demo message' });
async function actionId(dataDir: string): Promise<string> {
  const actions = jsonOutput(await cli(dataDir, ['actions'])) as Action[];
  return actions[0].id;
}
describe('SIGKILL and real-process restart demos', () => {
  it('Demo 1 PASS: a preference is remembered after a restart', async () => {
    const temporaryStorage = temporaryData();
    try {
      const crashedCommand = await cli(temporaryStorage.dataDir, ['chat', '--message', toolMessage('memory_write', { content: 'Rahat prefers tea without sugar', source: 'owner:cli' })], { RAHAT_PI_CRASH_AT: 'memory_written' });
      expect(crashedCommand.signal).toBe('SIGKILL');
      const searchResult = await cli(temporaryStorage.dataDir, ['chat', '--message', toolMessage('memory_search', { query: 'tea' })]);
      expect(searchResult.stdout).toContain('tea without sugar');
      const state = jsonOutput(await cli(temporaryStorage.dataDir, ['state'])) as AppState;
      expect(Object.values(state.memories)).toHaveLength(1);
      expect(Object.values(state.memories)[0].source).toBe('owner:cli');
    } finally {
      temporaryStorage.cleanup();
    }
  });
  it('Demo 2 PASS: a briefing runs once per occurrence after restart', async () => {
    const temporaryStorage = temporaryData();
    const beforeOccurrence = { RAHAT_PI_NOW: '2026-10-24T07:59:00+06:00' };
    const dueOccurrence = { RAHAT_PI_NOW: '2026-10-24T08:00:00+06:00' };
    try {
      await cli(temporaryStorage.dataDir, ['chat', '--message', toolMessage('routine_create', { name: 'Daily', prompt: 'Brief Rahat', time: '08:00', missedRunPolicy: 'catchUpOnce' })], beforeOccurrence);
      const crashedCommand = await cli(temporaryStorage.dataDir, ['tick'], { ...dueOccurrence, RAHAT_PI_CRASH_AT: 'routine_submitted' });
      expect(crashedCommand.signal).toBe('SIGKILL');
      await cli(temporaryStorage.dataDir, ['tick'], dueOccurrence);
      await cli(temporaryStorage.dataDir, ['tick'], { RAHAT_PI_NOW: '2026-10-24T08:01:00+06:00' });
      const state = jsonOutput(await cli(temporaryStorage.dataDir, ['state'], dueOccurrence)) as AppState;
      expect(Object.values(state.routineRuns)).toHaveLength(1);
      expect(Object.values(state.routineRuns)[0].status).toBe('succeeded');
      expect(Object.values(state.routineRuns)[0].id).toBe(`${Object.keys(state.routines)[0]}:${Date.parse(dueOccurrence.RAHAT_PI_NOW)}`);
      expect(Object.keys(state.budgets)).toHaveLength(2); // create chat + one briefing, no duplicated generation
    } finally {
      temporaryStorage.cleanup();
    }
  });
  it('Demo 3 PASS: a draft survives a restart while awaiting approval', async () => {
    const temporaryStorage = temporaryData();
    try {
      const crashedCommand = await cli(temporaryStorage.dataDir, ['chat', '--message', proposal], { RAHAT_PI_CRASH_AT: 'action_proposed' });
      expect(crashedCommand.signal).toBe('SIGKILL');
      const actions = jsonOutput(await cli(temporaryStorage.dataDir, ['actions'])) as Action[];
      expect(actions).toHaveLength(1);
      expect(actions[0].status).toBe('proposed');
      expect(jsonOutput(await cli(temporaryStorage.dataDir, ['outbox']))).toHaveLength(0);
    } finally {
      temporaryStorage.cleanup();
    }
  });
  it('Demo 4 PASS: approving sends exactly once across an approval crash', async () => {
    const temporaryStorage = temporaryData();
    try {
      await cli(temporaryStorage.dataDir, ['chat', '--message', proposal]);
      const approvedActionId = await actionId(temporaryStorage.dataDir);
      const crashedCommand = await cli(temporaryStorage.dataDir, ['approve', approvedActionId], { RAHAT_PI_CRASH_AT: 'action_approved' });
      expect(crashedCommand.signal).toBe('SIGKILL');
      await cli(temporaryStorage.dataDir, ['tick']);
      await cli(temporaryStorage.dataDir, ['tick']);
      const actions = jsonOutput(await cli(temporaryStorage.dataDir, ['actions'])) as Action[];
      expect(actions[0].status).toBe('succeeded');
      expect(actions[0].providerReceipt).toMatch(/^fake:/);
      expect(jsonOutput(await cli(temporaryStorage.dataDir, ['outbox']))).toHaveLength(1);
    } finally {
      temporaryStorage.cleanup();
    }
  });
  it('Demo 5 PASS: crash after dispatch shows unknown and never resends blindly', async () => {
    const temporaryStorage = temporaryData();
    try {
      await cli(temporaryStorage.dataDir, ['chat', '--message', proposal]);
      await cli(temporaryStorage.dataDir, ['approve', await actionId(temporaryStorage.dataDir)]);
      const crashedCommand = await cli(temporaryStorage.dataDir, ['tick'], { RAHAT_PI_CRASH_AT: 'after_dispatch' });
      expect(crashedCommand.signal).toBe('SIGKILL');
      const actions = jsonOutput(await cli(temporaryStorage.dataDir, ['actions'])) as Action[];
      expect(actions[0].status).toBe('unknown');
      expect(actions[0].providerReceipt).toBeNull();
      const originalOutbox = jsonOutput(await cli(temporaryStorage.dataDir, ['outbox']));
      expect(originalOutbox).toHaveLength(1);
      await cli(temporaryStorage.dataDir, ['reconcile']);
      await cli(temporaryStorage.dataDir, ['tick']);
      expect(jsonOutput(await cli(temporaryStorage.dataDir, ['outbox']))).toEqual(originalOutbox);
      const recoveredActions = jsonOutput(await cli(temporaryStorage.dataDir, ['actions'])) as Action[];
      expect(recoveredActions[0].status).toBe('succeeded');
      expect(recoveredActions[0].providerReceipt).toBe(originalOutbox[0].receipt);
    } finally {
      temporaryStorage.cleanup();
    }
  });
});

it('resumes a crash-interrupted input instead of omitting it as an unanswered turn', async () => {
  const temporaryStorage = temporaryData();
  try {
    const message = toolMessage('memory_write', { content: 'crash resume sentinel', source: 'owner:cli' });
    expect((await cli(temporaryStorage.dataDir, ['chat', '--message', message], {
      RAHAT_PI_CRASH_AT: 'memory_written',
    })).signal).toBe('SIGKILL');
    await cli(temporaryStorage.dataDir, ['tick']);
    const { App } = await import('../../src/harness/app.js');
    const { offlineConfig } = await import('../helpers.js');
    const { BACKGROUND_CONTEXT: context } = await import('@earendil-works/chord/context');
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      const activeContext = await app.root.context(context);
      expect(JSON.stringify(activeContext.messages)).toContain('crash resume sentinel');
      expect(activeContext.entries.some(entry => entry.kind === 'rahat.unanswered-context')).toBe(false);
      const state = await app.dispatch({ name: 'state' }) as AppState;
      expect(Object.values(state.memories)).toHaveLength(1);
      expect(activeContext.messages.at(-1)?.role).toBe('assistant');
    } finally {
      await app.close();
    }
  } finally {
    temporaryStorage.cleanup();
  }
});
