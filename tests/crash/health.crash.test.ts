import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { App } from '../../src/harness/app.js';
import type { StoppedTask } from '../../src/harness/health.js';
import { cli, jsonOutput, offlineConfig, temporaryData, toolMessage } from '../helpers.js';

const restartLimit = 5;

async function resumeBriefly(dataDir: string, crashPoint: string) {
  const resumeProcess = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/resume-briefly.ts', dataDir], {
    env: { ...process.env, OPENROUTER_API_KEY: '', RAHAT_PI_CRASH_AT: crashPoint, RAHAT_PI_NOW: '' },
    stdio: 'ignore',
  });
  const [exitCode, signal] = await once(resumeProcess, 'exit') as [number | null, NodeJS.Signals | null];
  return { exitCode, signal };
}

it('lists a tool parked after repeated crashes and runs it again on retry', async () => {
  const temporaryStorage = temporaryData();
  try {
    // The replay-safe memory_write reruns on every start and crashes again right after its commit.
    const firstRun = await cli(temporaryStorage.dataDir, [
      'chat', '--message', toolMessage('memory_write', { content: 'Survives a crash loop', source: 'owner' }),
    ], { RAHAT_PI_CRASH_AT: 'memory_written' });
    expect(firstRun.signal).toBe('SIGKILL');
    let crashes = 1;
    while (true) {
      const resumed = await resumeBriefly(temporaryStorage.dataDir, 'memory_written');
      if (resumed.signal !== 'SIGKILL') {
        expect(resumed.exitCode).toBe(0);
        break;
      }
      crashes += 1;
      expect(crashes).toBeLessThanOrEqual(restartLimit);
    }
    expect(crashes).toBe(restartLimit);

    const health = jsonOutput(await cli(temporaryStorage.dataDir, ['health'])) as { stoppedTasks: StoppedTask[] };
    expect(health.stoppedTasks).toMatchObject([
      { kind: 'pi.tool', label: 'Tool call (memory_write)', reason: 'restart_limit', restarts: restartLimit, canRetry: true },
    ]);
    expect((await cli(temporaryStorage.dataDir, ['stats', '--json'])).stdout).toContain('"parked": 1');
    const [stoppedTask] = health.stoppedTasks;

    expect(jsonOutput(await cli(temporaryStorage.dataDir, ['retry', String(stoppedTask.taskId)])))
      .toEqual({ retried: stoppedTask.taskId, label: 'Tool call (memory_write)' });
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      app.harness.resume();
      await app.harness.waitForIdle(context);
      expect(await app.dispatch({ name: 'health' })).toEqual({ stoppedTasks: [] });
      expect((await app.dispatch({ name: 'memories' }) as { content: string }[]).map(memory => memory.content))
        .toEqual(['Survives a crash loop']);
      await expect(app.dispatch({ name: 'retry', taskId: stoppedTask.taskId })).rejects.toThrow('No stopped task with that id');
    } finally {
      await app.close();
    }
  } finally {
    temporaryStorage.cleanup();
  }
}, 120000);
