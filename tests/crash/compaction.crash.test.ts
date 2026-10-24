import { describe, expect, it } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { CompactionEntry } from '@earendil-works/pi-durable';
import { App } from '../../src/harness/app.js';
import { AppDoc } from '../../src/harness/state.js';
import { cli, offlineConfig, temporaryData, toolMessage } from '../helpers.js';

describe('compaction SIGKILL recovery', () => {
  it.each(['compaction_started', 'compaction_summary_ready'])(
    'retains every original entry and places one summary after %s and repeated restarts',
    async crashPoint => {
      const temporaryStorage = temporaryData();
      const overrides = { RAHAT_PI_COMPACT_AT_TOKENS: '8000' };
      try {
        const originalApp = await App.open(offlineConfig(temporaryStorage.dataDir, overrides));
        await originalApp.dispatch({ name: 'chat', message: 'The launch codename is ORCHID.' });
        await originalApp.dispatch({ name: 'chat', message: toolMessage('memory_write', { content: 'Rahat prefers tea', source: 'owner:cli' }) });
        await originalApp.dispatch({ name: 'chat', message: 'The launch codename is ORCHID. '.repeat(100) });
        await originalApp.dispatch({ name: 'chat', message: 'Continue tomorrow. '.repeat(100) });
        const originalEntries = (await originalApp.root.entries({}, 1000, undefined, context)).items;
        const originalState = (await originalApp.harness.snapshot(AppDoc, context))!;
        await originalApp.close();
        const crashedCommand = await cli(temporaryStorage.dataDir, ['compact'], { ...overrides, RAHAT_PI_CRASH_AT: crashPoint });
        expect(crashedCommand.signal).toBe('SIGKILL');
        const interruptedApp = await App.open(offlineConfig(temporaryStorage.dataDir, overrides));
        try {
          expect((await interruptedApp.root.entries({}, 1000, undefined, context)).items).toEqual(originalEntries);
          const interruptedState = (await interruptedApp.harness.snapshot(AppDoc, context))!;
          expect(Object.keys(interruptedState.budgets).filter(budgetId => budgetId.startsWith('compaction:'))).toHaveLength(1);
          expect(Object.values(interruptedState.dailyReservations)[0]).toBeGreaterThan(Object.values(originalState.dailyReservations)[0]);
        } finally {
          await interruptedApp.close();
        }
        await cli(temporaryStorage.dataDir, ['tick'], overrides);
        await cli(temporaryStorage.dataDir, ['tick'], overrides);
        const recoveredApp = await App.open(offlineConfig(temporaryStorage.dataDir, overrides));
        try {
          const recoveredEntries = (await recoveredApp.root.entries({}, 1000, undefined, context)).items;
          expect(recoveredEntries.filter(entry => !CompactionEntry.is(entry))).toEqual(originalEntries);
          expect(recoveredEntries.filter(entry => CompactionEntry.is(entry))).toHaveLength(1);
          expect(new Set(recoveredEntries.map(entry => entry.id)).size).toBe(recoveredEntries.length);
          expect(JSON.stringify((await recoveredApp.root.context(context)).head)).toContain('ORCHID');
          const recoveredState = (await recoveredApp.harness.snapshot(AppDoc, context))!;
          expect(recoveredState.memories).toEqual(originalState.memories);
          expect(Object.keys(recoveredState.budgets).filter(budgetId => budgetId.startsWith('compaction:'))).toHaveLength(1);
          expect(await recoveredApp.dispatch({ name: 'chat', message: toolMessage('memory_search', { query: 'tea' }) })).toMatchObject({ reply: expect.stringContaining('Rahat prefers tea') });
          expect(await recoveredApp.dispatch({ name: 'chat', message: 'chat after crash' })).toMatchObject({ reply: 'Offline reply: chat after crash' });
        } finally {
          await recoveredApp.close();
        }
      } finally {
        temporaryStorage.cleanup();
      }
    },
  );
});
