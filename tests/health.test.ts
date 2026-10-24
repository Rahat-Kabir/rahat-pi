import { describe, expect, it, vi } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { TaskInspection } from '@earendil-works/pi-durable';
import { App } from '../src/harness/app.js';
import { describeTask } from '../src/harness/health.js';
import { AppDoc } from '../src/harness/state.js';
import { offlineConfig, temporaryData, toolMessage } from './helpers.js';

async function routineTaskRecord(app: App) {
  await app.dispatch({ name: 'chat', message: toolMessage('routine_create', { name: 'Daily briefing', prompt: 'Brief me', time: '08:00', missedRunPolicy: 'skip' }) });
  const routine = Object.values((await app.harness.snapshot(AppDoc, context))!.routines)[0];
  return (await app.harness.getTask(routine.taskId as never, context))! as TaskInspection['record'];
}
function blocked(record: TaskInspection['record'], reason: 'restart_limit' | 'missing_task'): TaskInspection {
  return { record, state: { kind: 'blocked', reason } };
}

describe('stopped task health', () => {
  it('describes each kind of stopped task in plain words', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      const record = await routineTaskRecord(app);
      const routines = (await app.harness.snapshot(AppDoc, context))!.routines;
      const describe = (changes: object, liveTools: { callId: string; name: string }[] = []) =>
        describeTask(blocked({ ...record, ...changes } as TaskInspection['record'], 'restart_limit'), routines, liveTools, app.root.id);
      expect(describe({})).toBe('Routine "Daily briefing"');
      expect(describe({ input: { routineId: 'deleted' } })).toBe('Routine');
      expect(describe({ kind: 'pi.generation', conversationId: app.root.id })).toBe('Chat answer');
      expect(describe({ kind: 'pi.generation', conversationId: 'child-conversation' })).toBe('Helper answer');
      expect(describe({ kind: 'pi.compaction' })).toBe('Chat summary');
      expect(describe({ kind: 'pi.tool', input: { kind: 'model', callId: 'call-1' } }, [{ callId: 'call-1', name: 'web_fetch' }])).toBe('Tool call (web_fetch)');
      expect(describe({ kind: 'pi.tool', input: { kind: 'model', callId: 'gone' } })).toBe('Tool call');
      expect(describe({ kind: 'pi.tool', input: { kind: 'nested', call: { name: 'memory_search' } } })).toBe('Tool call (memory_search)');
      expect(describe({ kind: 'someone.else' })).toBe('someone.else');
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('retries only a task parked after crashes and explains every refusal', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      const record = await routineTaskRecord(app);
      const missingCode = { ...record, id: 999999 } as TaskInspection['record'];
      vi.spyOn(app.harness, 'inspect').mockResolvedValue({
        scheduling: 'paused', submissions: [],
        tasks: [blocked(record, 'restart_limit'), blocked(missingCode, 'missing_task'), { record, state: { kind: 'sleeping', until: 1 } }],
      });
      const retryTask = vi.spyOn(app.harness, 'retryTask').mockResolvedValue();

      expect(await app.dispatch({ name: 'health' })).toEqual({ stoppedTasks: [
        { taskId: record.id, kind: 'rahat.daily-briefing', label: 'Routine "Daily briefing"', reason: 'restart_limit', restarts: 0, canRetry: true },
        { taskId: 999999, kind: 'rahat.daily-briefing', label: 'Routine "Daily briefing"', reason: 'missing_task', restarts: 0, canRetry: false },
      ] });
      await expect(app.dispatch({ name: 'retry', taskId: 999999 })).rejects.toThrow('Cannot retry: the task is blocked (missing_task)');
      await expect(app.dispatch({ name: 'retry', taskId: 123 })).rejects.toThrow('No stopped task with that id');
      expect(retryTask).not.toHaveBeenCalled();
      expect(await app.dispatch({ name: 'retry', taskId: record.id })).toEqual({ retried: record.id, label: 'Routine "Daily briefing"' });
      expect(retryTask).toHaveBeenCalledWith(record.id, context);
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });
});
