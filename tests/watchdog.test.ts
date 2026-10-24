import { describe, expect, it, vi } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { TaskId } from '@earendil-works/pi-durable';
import { App } from '../src/harness/app.js';
import { AppDoc } from '../src/harness/state.js';
import { offlineConfig, temporaryData, toolMessage } from './helpers.js';

const waitMilliseconds = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

describe('safety watchdog', () => {
  it('stops re-checking finished subagents and already-stopped routines', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      await app.dispatch({ name: 'chat', message: toolMessage('subagent_run', { task: 'finish quickly' }) });
      await app.dispatch({
        name: 'chat',
        message: toolMessage('routine_create', { name: 'Daily', prompt: 'Briefing', time: '08:00', missedRunPolicy: 'skip' }),
      });
      const routine = Object.values((await app.harness.snapshot(AppDoc, context))!.routines)[0];
      await app.dispatch({ name: 'chat', message: toolMessage('routine_pause', { id: routine.id }) });
      await vi.waitFor(async () => {
        const routineTask = await app.harness.getTask(routine.taskId as TaskId, context);
        expect(routineTask?.state.status).toBe('terminal');
      });
      // Give the 50 ms watchdog a few ticks to see that both tasks are finished.
      await waitMilliseconds(250);
      const getTaskSpy = vi.spyOn(app.harness, 'getTask');
      const abortTaskSpy = vi.spyOn(app.harness, 'abortTask');
      await waitMilliseconds(300);
      expect(abortTaskSpy).not.toHaveBeenCalled();
      expect(getTaskSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      await app.close();
      temporaryStorage.cleanup();
    }
  });
});
