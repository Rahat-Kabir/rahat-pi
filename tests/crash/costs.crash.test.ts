import { expect, it } from 'vitest';
import { App } from '../../src/harness/app.js';
import { cli, offlineConfig, temporaryData, toolMessage } from '../helpers.js';

it.each(['compaction_started', 'compaction_summary_ready'])(
  'retains known and unknown costs after SIGKILL at %s with settlement and no recounting on inspection',
  async crashPoint => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_COMPACT_AT_TOKENS: '8000' });
    try {
      const original = await App.open(config);
      await original.dispatch({ name: 'chat', message: 'ORCHID project facts. '.repeat(100) });
      await original.dispatch({ name: 'chat', message: 'Continue tomorrow. '.repeat(100) });
      const previousStats = await original.stats();
      await original.close();
      expect((await cli(temporaryStorage.dataDir, ['compact'], { RAHAT_PI_CRASH_AT: crashPoint })).signal).toBe('SIGKILL');
      const interrupted = await App.open(config);
      const interruptedStats = await interrupted.stats();
      expect(interruptedStats.total.requests).toBe(previousStats.total.requests + 1);
      expect(interruptedStats.total.reservedUsd).toBeGreaterThan(previousStats.total.reservedUsd);
      expect(interruptedStats.total.unknownRequests).toBe(crashPoint === 'compaction_started' ? 1 : 0);
      expect(interruptedStats.total.openReservedUsd).toBe(0);
      if (crashPoint === 'compaction_started') {
        expect(interruptedStats.total.unknownReservedUsd).toBeGreaterThan(0);
      } else {
        expect(interruptedStats.total.unknownReservedUsd).toBe(0);
        expect(interruptedStats.total.countedUsd).toBe(interruptedStats.total.actualUsd);
      }
      expect(interruptedStats.tasks.crashed).toBeGreaterThanOrEqual(1);
      expect(await interrupted.stats()).toEqual(interruptedStats);
      await interrupted.close();
      await cli(temporaryStorage.dataDir, ['tick']);
      const recovered = await App.open(config);
      try {
        const recoveredStats = await recovered.stats();
        expect(recoveredStats.total.requests).toBe(interruptedStats.total.requests + 1);
        expect(recoveredStats.total.unknownRequests).toBe(interruptedStats.total.unknownRequests);
        expect(recoveredStats.total.openReservedUsd).toBe(0);
        expect(recoveredStats.total.unknownReservedUsd).toBe(interruptedStats.total.unknownReservedUsd);
        expect(recoveredStats.total.reservedUsd).toBeGreaterThan(interruptedStats.total.reservedUsd);
        await recovered.dispatch({ name: 'tick' });
        expect((await recovered.stats()).total).toEqual(recoveredStats.total);
      } finally {
        await recovered.close();
      }
    } finally {
      temporaryStorage.cleanup();
    }
  },
);

it('shows an interrupted child request as unknown before recovery', async () => {
  const temporaryStorage = temporaryData();
  try {
    const message = toolMessage('subagent_run', { task: 'child cost recovery' });
    expect((await cli(temporaryStorage.dataDir, ['chat', '--message', message], { RAHAT_PI_CRASH_AT: 'subagent_started' })).signal).toBe('SIGKILL');
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      const stats = await app.stats();
      expect(stats.models.find(model => model.role === 'subagent')?.total.unknownRequests).toBe(1);
      expect(stats.subagents.total).toBe(1);
      expect(stats.total.reservedUsd).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  } finally {
    temporaryStorage.cleanup();
  }
});
