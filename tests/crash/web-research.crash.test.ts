import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { App } from '../../src/harness/app.js';
import { AppDoc } from '../../src/harness/state.js';
import { offlineConfig, temporaryData } from '../helpers.js';

it('replays an interrupted web fetch after SIGKILL and retains one result across repeated restarts', async () => {
  const temporaryStorage = temporaryData();
  let requestCount = 0;
  let markRequestStarted: () => void = () => {};
  const requestStarted = new Promise<void>(resolveStarted => {
    markRequestStarted = resolveStarted;
  });
  const server = createServer((_request, response) => {
    requestCount += 1;
    response.setHeader('Content-Type', 'text/plain');
    if (requestCount === 1) {
      response.write('interrupted body');
      markRequestStarted();
      return;
    }
    response.end('Recovered web data');
  });
  await new Promise<void>(resolveListening => server.listen(0, '127.0.0.1', resolveListening));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/page`;
  const startWorker = () => {
    const worker = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/web-fetch-worker.ts', temporaryStorage.dataDir, url], {
      env: { ...process.env, OPENROUTER_API_KEY: '', RAHAT_PI_CRASH_AT: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    worker.stdout.on('data', chunk => {
      stdout += chunk;
    });
    worker.stderr.on('data', chunk => {
      stderr += chunk;
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolveExit, reject) => {
      worker.once('error', reject);
      worker.once('close', (code, signal) => resolveExit({ code, signal, stdout, stderr }));
    });
    return { worker, exited };
  };
  const first = startWorker();
  try {
    await Promise.race([
      requestStarted,
      first.exited.then(result => { throw new Error(`Worker exited early: ${result.stderr}`); }),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Fetch never started')), 5000).unref()),
    ]);
    first.worker.kill('SIGKILL');
    expect((await first.exited).signal).toBe('SIGKILL');
    for (let restartNumber = 0; restartNumber < 2; restartNumber++) {
      const restarted = startWorker();
      const result = await restarted.exited;
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain('Recovered web data');
    }
    expect(requestCount).toBe(2);
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      const entries = await app.harness.commit(transaction => transaction.scanEntries({ conversationId: app.root.id }, 100), context);
      const results = entries.items.flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult' && message.toolName === 'web_fetch');
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ isError: false });
      const state = (await app.harness.snapshot(AppDoc, context))!;
      expect(state.memories).toEqual({});
      expect(state.actions).toEqual({});
      expect(await app.dispatch({ name: 'outbox' })).toEqual([]);
    } finally {
      await app.close();
    }
  } finally {
    first.worker.kill('SIGKILL');
    await first.exited;
    server.closeAllConnections();
    await new Promise<void>(resolveClosed => server.close(() => resolveClosed()));
    temporaryStorage.cleanup();
  }
});
