import { it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { cli, temporaryData, toolMessage, jsonOutput } from './helpers.js';
import type { Action } from '../src/harness/state.js';

it('service owns Pi storage, accepts CLI chat/approvals, executes once, and stops background tasks', async () => {
  const temporaryStorage = temporaryData();
  const service = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    env: { ...process.env, OPENROUTER_API_KEY: '', RAHAT_PI_OFFLINE: '1', RAHAT_PI_DATA_DIR: temporaryStorage.dataDir, RAHAT_PI_NOW: '', RAHAT_PI_CRASH_AT: '', RAHAT_PI_COMPACT_AT_TOKENS: '8000' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  service.stdout.on('data', chunk => {
    stdout += chunk;
  });
  service.stderr.on('data', chunk => {
    stderr += chunk;
  });
  const serviceExit = once(service, 'exit');
  try {
    for (let attempt = 0; !stdout.includes('service ready'); attempt++) {
      if (attempt > 500 || service.exitCode !== null) {
        throw new Error(`Service failed: ${stderr}`);
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(existsSync(`${temporaryStorage.dataDir}/agent.sock`)).toBe(true);
    const chatResult = await cli(temporaryStorage.dataDir, ['chat', '--message', 'hello']);
    expect(chatResult.stdout).toContain('Offline reply: hello');
    await cli(temporaryStorage.dataDir, ['chat', '--message', toolMessage('routine_create', { name: 'Daily', prompt: 'Briefing', time: '08:00', missedRunPolicy: 'skip' })]);
    await cli(temporaryStorage.dataDir, ['chat', '--message', toolMessage('propose_send_message', { recipient: 'fixture:owner', body: 'hello' })]);
    const actions = jsonOutput(await cli(temporaryStorage.dataDir, ['actions'])) as Action[];
    await cli(temporaryStorage.dataDir, ['approve', actions[0].id]);
    for (let attempt = 0; attempt < 100; attempt++) {
      const updatedActions = jsonOutput(await cli(temporaryStorage.dataDir, ['actions'])) as Action[];
      if (updatedActions[0].status === 'succeeded') {
        break;
      }
      if (attempt === 99) {
        throw new Error('Executor did not complete');
      }
    }
    expect(jsonOutput(await cli(temporaryStorage.dataDir, ['outbox']))).toHaveLength(1);
    await cli(temporaryStorage.dataDir, ['chat', '--message', 'Context for compaction. '.repeat(300)]);
    expect(jsonOutput(await cli(temporaryStorage.dataDir, ['compact']))).toMatchObject({ compacted: true });
    expect((await cli(temporaryStorage.dataDir, ['chat', '--message', 'after service compaction'])).stdout).toContain('Offline reply: after service compaction');
    await cli(temporaryStorage.dataDir, ['stop']);
    const result = await Promise.race([serviceExit, new Promise((_resolvedValue, reject) => setTimeout(() => reject(new Error('stop did not terminate service')), 5000).unref())]);
    expect(result).toEqual([0, null]);
    // Removing the stop flag is explicit service-start behavior; state inspection remains available.
    const state = jsonOutput(await cli(temporaryStorage.dataDir, ['state']));
    expect(Object.values(state.routines)).toHaveLength(1);
  } finally {
    if (service.exitCode === null) {
      service.kill('SIGKILL');
      await serviceExit;
    }
    temporaryStorage.cleanup();
  }
});
