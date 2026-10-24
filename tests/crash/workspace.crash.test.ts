import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from '../../src/harness/app.js';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { cli, offlineConfig, temporaryData, toolMessage } from '../helpers.js';

it('reports an interrupted shell after SIGKILL and never reruns its append across repeated restarts', async () => {
  const temporaryStorage = temporaryData();
  const markerPath = join(temporaryStorage.dataDir, 'workspace', 'once.txt');
  const escapedPath = join(temporaryStorage.dataDir, 'workspace', 'survived.txt');
  const message = toolMessage('workspace_shell', {
    command: "echo once >> once.txt; setsid sh -c 'sleep 1; echo survived > survived.txt' & sleep 60",
  });
  const commandArguments = ['chat', '--message', message, '--request-id', 'workspace-crash-check'];
  const childProcess = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...commandArguments], {
    env: {
      ...process.env, OPENROUTER_API_KEY: '', RAHAT_PI_OFFLINE: '1',
      RAHAT_PI_DATA_DIR: temporaryStorage.dataDir, RAHAT_PI_CRASH_AT: '', RAHAT_PI_NOW: '',
    },
    stdio: 'ignore',
  });
  const childExit = new Promise<NodeJS.Signals | null>(resolveExit => childProcess.once('exit', (_exitCode, signal) => resolveExit(signal)));
  try {
    for (let attemptNumber = 0; attemptNumber < 500; attemptNumber++) {
      if (existsSync(markerPath)) {
        break;
      }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
    }
    expect(readFileSync(markerPath, 'utf8')).toBe('once\n');
    childProcess.kill('SIGKILL');
    expect(await childExit).toBe('SIGKILL');
    for (let restartNumber = 0; restartNumber < 2; restartNumber++) {
      const result = await cli(temporaryStorage.dataDir, commandArguments);
      expect(result.stdout).toContain('interrupted');
      expect(result.stdout).toContain('may have partially run');
      expect(readFileSync(markerPath, 'utf8')).toBe('once\n');
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 1100));
    expect(existsSync(escapedPath)).toBe(false);
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      const entries = await app.harness.commit(transaction => transaction.scanEntries({ conversationId: app.root.id }, 100), context);
      const toolResults = entries.items.flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult' && message.toolName === 'workspace_shell');
      expect(toolResults).toHaveLength(1);
      expect(toolResults[0]).toMatchObject({ isError: true });
      expect(JSON.stringify(toolResults[0])).toContain('interrupted');
    } finally {
      await app.close();
    }
  } finally {
    childProcess.kill('SIGKILL');
    await childExit;
    temporaryStorage.cleanup();
  }
});
