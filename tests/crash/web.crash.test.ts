import { expect, it } from 'vitest';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { App } from '../../src/harness/app.js';
import type { Action } from '../../src/harness/state.js';
import type { WebState } from '../../src/web/state.js';
import { offlineConfig, temporaryData, toolMessage } from '../helpers.js';

async function availablePort() {
  const listener = createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing test TCP address');
  }
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return address.port;
}
async function startWebProcess(dataDir: string, port: number, crashPoint = '') {
  const environment = {
    ...process.env, OPENROUTER_API_KEY: '', RAHAT_PI_OFFLINE: '1', RAHAT_PI_DATA_DIR: dataDir,
    RAHAT_PI_WEB_PORT: String(port), RAHAT_PI_NOW: '', RAHAT_PI_CRASH_AT: crashPoint,
  };
  const service = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'web'], {
    env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(service, 'exit');
  let stdout = '';
  let stderr = '';
  service.stdout.on('data', chunk => {
    stdout += chunk;
  });
  service.stderr.on('data', chunk => {
    stderr += chunk;
  });
  for (let attempt = 0; !stdout.includes('service ready'); attempt++) {
    if (attempt > 500 || service.exitCode !== null || service.signalCode !== null) {
      service.kill('SIGKILL');
      throw new Error(`Web service failed: ${stderr}`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return { service, exited, environment };
}

it.each(['action_approved', 'after_dispatch'])(
  'reconnects the web UI after SIGKILL at %s and executes the hash-approved payload once',
  async crashPoint => {
    const temporaryStorage = temporaryData();
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const initialApp = await App.open(offlineConfig(temporaryStorage.dataDir));
    await initialApp.dispatch({ name: 'chat', message: toolMessage('propose_send_message', { recipient: 'fixture:owner', body: 'Web crash proof' }) });
    const actions = await initialApp.dispatch({ name: 'actions' }) as Action[];
    const action = actions[0];
    await initialApp.close();
    const firstProcess = await startWebProcess(temporaryStorage.dataDir, port, crashPoint);
    let restartedProcess: Awaited<ReturnType<typeof startWebProcess>> | undefined;
    try {
      const token = readFileSync(join(temporaryStorage.dataDir, 'web-token'), 'utf8').trim();
      const approvalRequest = fetch(baseUrl + '/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Rahat-Token': token },
        body: JSON.stringify({ decision: 'approve', id: action.id, payloadHash: action.payloadHash }),
      }).catch(error => error);
      const exitTimeout = setTimeout(() => firstProcess.service.kill('SIGTERM'), 5000);
      try {
        expect(await firstProcess.exited).toEqual([null, 'SIGKILL']);
      } finally {
        clearTimeout(exitTimeout);
      }
      await approvalRequest;
      const inspection = await App.open(offlineConfig(temporaryStorage.dataDir));
      try {
        expect(await inspection.dispatch({ name: 'actions' })).toMatchObject([{ status: crashPoint === 'action_approved' ? 'approved' : 'unknown', approvedHash: action.payloadHash }]);
        expect(await inspection.dispatch({ name: 'outbox' })).toHaveLength(crashPoint === 'action_approved' ? 0 : 1);
      } finally {
        await inspection.close();
      }
      restartedProcess = await startWebProcess(temporaryStorage.dataDir, port);
      const controller = new AbortController();
      try {
        const response = await fetch(baseUrl + '/api/events', { signal: controller.signal });
        const reader = response.body!.getReader();
        let frames = '';
        while (!frames.includes('"status":"succeeded"')) {
          const result = await reader.read();
          if (result.done) {
            throw new Error('Reconnected stream ended');
          }
          frames += new TextDecoder().decode(result.value);
        }
        expect(frames).toContain('Web crash proof');
      } finally {
        controller.abort();
      }
      const state = await (await fetch(baseUrl + '/api/state')).json() as WebState;
      expect(state.actions).toMatchObject([{ status: 'succeeded', approvedHash: action.payloadHash, providerReceipt: expect.stringMatching(/^fake:/) }]);
      const snapshotResult = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/web-snapshot.ts'], { env: restartedProcess.environment });
      expect(snapshotResult.stdout).toContain(join(temporaryStorage.dataDir, 'web-snapshot.html'));
      expect(readFileSync(join(temporaryStorage.dataDir, 'web-snapshot.html'), 'utf8')).toContain('Web crash proof');
      restartedProcess.service.kill('SIGTERM');
      expect(await restartedProcess.exited).toEqual([0, null]);
      const finalApp = await App.open(offlineConfig(temporaryStorage.dataDir));
      try {
        await finalApp.executor.tick();
        expect(await finalApp.dispatch({ name: 'outbox' })).toHaveLength(1);
      } finally {
        await finalApp.close();
      }
    } finally {
      for (const runningProcess of [firstProcess, restartedProcess]) {
        if (runningProcess && runningProcess.service.exitCode === null && runningProcess.service.signalCode === null) {
          runningProcess.service.kill('SIGKILL');
          await runningProcess.exited;
        }
      }
      temporaryStorage.cleanup();
    }
  },
);
