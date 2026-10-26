import { describe, it, expect } from 'vitest';
import { App } from '../../src/harness/app.js';
import { cli, offlineConfig, temporaryData, toolMessage } from '../helpers.js';

describe('owner routine commands across SIGKILL', () => {
  it('a routine resumed just before a crash stays on and runs once at its next time', async () => {
    const temporaryStorage = temporaryData();
    const beforeMorning = { RAHAT_PI_NOW: '2026-10-24T07:00:00+06:00' };
    const morning = { RAHAT_PI_NOW: '2026-10-24T08:00:00+06:00' };
    const atTime = async <Result>(clock: Record<string, string>, work: (app: App) => Promise<Result>) => {
      const app = await App.open(offlineConfig(temporaryStorage.dataDir, clock));
      try {
        return await work(app);
      } finally {
        await app.close();
      }
    };
    try {
      const routineId = await atTime(beforeMorning, async app => {
        await app.dispatch({ name: 'chat', message: toolMessage('routine_create', {
          name: 'Morning', prompt: 'Morning briefing', time: '08:00', missedRunPolicy: 'catchUpOnce',
        }) });
        const [routine] = await app.listRoutines();
        await app.dispatch({ name: 'pauseRoutine', id: routine.id });
        return routine.id;
      });

      const crashedCommand = await cli(temporaryStorage.dataDir, ['routine', 'resume', routineId], { ...beforeMorning, RAHAT_PI_CRASH_AT: 'routine_resumed' });
      expect(crashedCommand.signal).toBe('SIGKILL');

      const routineAfterRuns = await atTime(morning, async app => {
        await app.dispatch({ name: 'tick' });
        await app.dispatch({ name: 'tick' });
        return (await app.listRoutines())[0];
      });
      await atTime({ RAHAT_PI_NOW: '2026-10-24T08:01:00+06:00' }, app => app.dispatch({ name: 'tick' }));
      const state = await atTime(morning, app => app.dispatch({ name: 'state' })) as { routineRuns: Record<string, { status: string }> };
      expect(routineAfterRuns).toMatchObject({ enabled: true, lastRun: { occurrenceTime: Date.parse(morning.RAHAT_PI_NOW), status: 'succeeded' } });
      expect(Object.values(state.routineRuns)).toHaveLength(1);
    } finally {
      temporaryStorage.cleanup();
    }
  });
});
