import { describe, expect, it, vi } from 'vitest';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:http';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { App } from '../src/harness/app.js';
import * as modelSetup from '../src/harness/models.js';
import { configFromEnv } from '../src/config.js';
import { startWebServer } from '../src/web/server.js';
import { renderPage } from '../src/web/page.js';
import type { WebState } from '../src/web/state.js';
import { offlineConfig, temporaryData, toolMessage } from './helpers.js';

async function webFixture() {
  const temporaryStorage = temporaryData();
  const config = offlineConfig(temporaryStorage.dataDir);
  const app = await App.open(config);
  const server = await startWebServer(app, 0);
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const token = readFileSync(join(config.dataDir, 'web-token'), 'utf8').trim();
  return {
    app, server, baseUrl, token, temporaryStorage, config,
    async cleanup() {
      await server.close();
      await app.stop();
      temporaryStorage.cleanup();
    },
  };
}
function post(baseUrl: string, token: string, path: string, body: unknown) {
  return fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Rahat-Token': token },
    body: JSON.stringify(body),
  });
}
function requestWithHost(baseUrl: string, host: string) {
  return new Promise<number | undefined>((resolve, reject) => {
    const outgoingRequest = request(baseUrl, { headers: { Host: host } }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    outgoingRequest.once('error', reject);
    outgoingRequest.end();
  });
}
function readState(baseUrl: string, token: string) {
  return fetch(baseUrl + '/api/state', { headers: { 'X-Rahat-Token': token } }).then(response => response.json() as Promise<WebState>);
}
async function openEvents(baseUrl: string, token: string) {
  const controller = new AbortController();
  const response = await fetch(baseUrl + '/api/events', { signal: controller.signal, headers: { 'X-Rahat-Token': token } });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let bufferedFrames = '';
  return {
    close: () => controller.abort(),
    async nextState(predicate: (state: WebState) => boolean = () => true) {
      while (true) {
        const boundary = bufferedFrames.indexOf('\n\n');
        if (boundary >= 0) {
          const frame = bufferedFrames.slice(0, boundary);
          bufferedFrames = bufferedFrames.slice(boundary + 2);
          const data = frame.split('\n').find(line => line.startsWith('data: '));
          if (data) {
            const state = JSON.parse(data.slice(6)) as WebState;
            if (predicate(state)) {
              return state;
            }
          }
          continue;
        }
        const result = await reader.read();
        if (result.done) {
          throw new Error('Event stream ended before expected state');
        }
        bufferedFrames += decoder.decode(result.value, { stream: true });
      }
    },
  };
}
async function waitForState(baseUrl: string, token: string, predicate: (state: WebState) => boolean) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const state = await readState(baseUrl, token);
    if (predicate(state)) {
      return state;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Web state did not settle');
}
function conversationText(state: WebState) {
  return JSON.stringify(state.entries);
}

describe('local web UI', () => {
  it('validates the web port without changing the default service command', () => {
    expect(configFromEnv({}).webPort).toBe(8787);
    for (const invalidPort of ['0', '-1', '1.5', '65536', 'NaN']) {
      expect(() => configFromEnv({ RAHAT_PI_WEB_PORT: invalidPort })).toThrow('RAHAT_PI_WEB_PORT');
    }
  });

  it('serves the page, protects Host, requires sign-in for every read and write, and never embeds credentials', async () => {
    const fixture = await webFixture();
    try {
      const response = await fetch(fixture.baseUrl, { headers: { 'X-Rahat-Token': fixture.token } });
      const page = await response.text();
      expect(response.status).toBe(200);
      expect(page).toContain('Main conversation');
      expect(page).toContain('Approvals');
      expect(page).toContain('Subagents');
      expect(page).toContain('Stats');
      expect(page).toContain('Today: actual $0.000000');
      expect(page).not.toContain(fixture.token);
      expect(page).not.toContain('OPENROUTER_API_KEY');
      expect(statSync(join(fixture.config.dataDir, 'web-token')).mode & 0o777).toBe(0o600);
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      for (const host of ['evil.example', `evil.example:${fixture.server.port}`, `127.0.0.1:${fixture.server.port + 1}`, `127.0.0.1:${fixture.server.port}.evil.example`]) {
        expect(await requestWithHost(fixture.baseUrl, host)).toBe(403);
      }
      // Signed out, the old page sends the owner to the app to sign in.
      expect(await requestWithHost(fixture.baseUrl, `localhost:${fixture.server.port}`)).toBe(303);
      const signedOutPage = await fetch(fixture.baseUrl, { redirect: 'manual' });
      expect(signedOutPage.headers.get('location')).toBe('/app/');
      expect(await signedOutPage.text()).not.toContain('Main conversation');
      for (const readPath of ['/api/state', '/api/events', '/api/session']) {
        expect((await fetch(fixture.baseUrl + readPath)).status).toBe(401);
        expect((await fetch(fixture.baseUrl + readPath, { headers: { 'X-Rahat-Token': 'bad-token' } })).status).toBe(401);
      }
      expect((await post(fixture.baseUrl, '', '/api/messages', { message: 'blocked' })).status).toBe(401);
      expect((await post(fixture.baseUrl, 'bad-token', '/api/actions', {})).status).toBe(401);
      expect((await post(fixture.baseUrl, fixture.token, '/api/messages', { message: '' })).status).toBe(400);
      expect((await post(fixture.baseUrl, fixture.token, '/api/messages', { message: 'oversized'.repeat(8000) })).status).toBe(413);
      expect((await post(fixture.baseUrl, fixture.token, '/api/messages', { message: 'hello', whenBusy: 'invalid' })).status).toBe(400);
      expect((await fetch(fixture.baseUrl + '/api/messages', {
        method: 'POST', headers: { 'X-Rahat-Token': fixture.token, 'Content-Type': 'application/json' }, body: '{',
      })).status).toBe(400);
      expect((await fetch(fixture.baseUrl + '/api/messages', {
        method: 'POST', headers: { 'X-Rahat-Token': fixture.token, 'Content-Type': 'text/plain' }, body: '{}',
      })).status).toBe(415);
    } finally {
      await fixture.cleanup();
    }
  });

  it('streams committed assistant partials, tool calls, and the final transcript over HTTP', async () => {
    const fauxModelProvider = fauxProvider({ tokenSize: { min: 1, max: 1 }, tokensPerSecond: 60 });
    const models = createModels();
    models.setProvider(fauxModelProvider.provider);
    const answer = 'A complete streamed answer with enough text to span several durable partial commits.';
    fauxModelProvider.setResponses([
      fauxAssistantMessage(fauxToolCall('memory_search', { query: 'tea' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage(answer),
    ]);
    const modelSpy = vi.spyOn(modelSetup, 'buildModels').mockReturnValue({ models, modelRef: { provider: 'faux', modelId: fauxModelProvider.getModel().id } });
    const fixture = await webFixture();
    const events = await openEvents(fixture.baseUrl, fixture.token);
    try {
      await events.nextState();
      const response = await post(fixture.baseUrl, fixture.token, '/api/messages', { message: 'Search then answer.' });
      expect(response.status).toBe(202);
      const toolState = await events.nextState(state => JSON.stringify(state).includes('memory_search'));
      expect(JSON.stringify(toolState)).toContain('tea');
      const partialState = await events.nextState(state => {
        const live = JSON.stringify(state.live);
        return live.includes('A complete') && !live.includes(answer);
      });
      expect(partialState.live).toHaveProperty('run');
      const finalState = await events.nextState(state => conversationText(state).includes(answer) && !('run' in state.live));
      expect(conversationText(finalState)).toContain('Search then answer.');
    } finally {
      events.close();
      await fixture.cleanup();
      modelSpy.mockRestore();
    }
  });

  it('admits steer and follow-up during a running turn without waiting for completion', async () => {
    let releaseFirstResponse: () => void = () => {};
    const firstResponseReady = new Promise<void>(resolve => {
      releaseFirstResponse = resolve;
    });
    let markStarted: () => void = () => {};
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const fauxModelProvider = fauxProvider({ tokensPerSecond: Infinity });
    const models = createModels();
    models.setProvider(fauxModelProvider.provider);
    fauxModelProvider.setResponses([
      async () => {
        markStarted();
        await firstResponseReady;
        return fauxAssistantMessage(fauxToolCall('memory_search', { query: 'tea' }), { stopReason: 'toolUse' });
      },
      fauxAssistantMessage('Steered answer'),
      fauxAssistantMessage('Follow-up answer'),
    ]);
    const modelSpy = vi.spyOn(modelSetup, 'buildModels').mockReturnValue({ models, modelRef: { provider: 'faux', modelId: fauxModelProvider.getModel().id } });
    const fixture = await webFixture();
    try {
      expect((await post(fixture.baseUrl, fixture.token, '/api/messages', { message: 'Start' })).status).toBe(202);
      await started;
      expect((await post(fixture.baseUrl, fixture.token, '/api/messages', { message: 'Change direction', whenBusy: 'steer' })).status).toBe(202);
      expect((await post(fixture.baseUrl, fixture.token, '/api/messages', { message: 'Next turn', whenBusy: 'followUp' })).status).toBe(202);
      const queued = await readState(fixture.baseUrl, fixture.token);
      expect(queued.inbox.items).toMatchObject([{ mode: 'steer', content: 'Change direction' }, { mode: 'followUp', content: 'Next turn' }]);
      releaseFirstResponse();
      const finalState = await waitForState(fixture.baseUrl, fixture.token, state => conversationText(state).includes('Follow-up answer') && !('run' in state.live));
      const messages = finalState.entries.flatMap(entry => entry.model);
      expect(messages.findIndex(message => message.content === 'Change direction')).toBeLessThan(messages.findIndex(message => message.content === 'Next turn'));
      expect(fauxModelProvider.state.callCount).toBe(3);
    } finally {
      releaseFirstResponse();
      await fixture.cleanup();
      modelSpy.mockRestore();
    }
  });

  it('binds HTTP decisions to the displayed hash and shares CLI approval and fake execution', async () => {
    const fixture = await webFixture();
    const events = await openEvents(fixture.baseUrl, fixture.token);
    try {
      await fixture.app.dispatch({ name: 'chat', message: toolMessage('propose_send_message', { recipient: 'fixture:owner', body: 'Original' }) });
      const state = await events.nextState(state => state.actions.length === 1);
      const action = state.actions[0];
      await fixture.app.dispatch({ name: 'edit', id: action.id, recipient: 'fixture:owner', body: 'Revised' });
      expect((await post(fixture.baseUrl, fixture.token, '/api/actions', { decision: 'approve', id: action.id, payloadHash: action.payloadHash })).status).toBe(409);
      expect((await post(fixture.baseUrl, fixture.token, '/api/actions', { decision: 'approve', id: action.id })).status).toBe(400);
      const edited = await events.nextState(state => state.actions[0]?.payload.body === 'Revised');
      const decision = { decision: 'approve', id: action.id, payloadHash: edited.actions[0].payloadHash };
      expect((await post(fixture.baseUrl, fixture.token, '/api/actions', decision)).status).toBe(200);
      expect((await post(fixture.baseUrl, fixture.token, '/api/actions', decision)).status).toBe(200);
      expect((await events.nextState(state => state.actions[0]?.status === 'approved')).actions[0].approvedHash).toBe(decision.payloadHash);
      await fixture.app.executor.tick();
      await fixture.app.executor.tick();
      expect(await fixture.app.dispatch({ name: 'outbox' })).toHaveLength(1);
      expect(await fixture.app.dispatch({ name: 'actions' })).toMatchObject([{ status: 'succeeded', payload: { body: 'Revised' } }]);
      await fixture.app.dispatch({ name: 'chat', message: toolMessage('propose_send_message', { recipient: 'fixture:owner', body: 'Reject this' }) });
      const secondState = await events.nextState(state => state.actions.length === 2);
      const secondAction = secondState.actions[1];
      expect((await post(fixture.baseUrl, fixture.token, '/api/actions', { decision: 'reject', id: secondAction.id, payloadHash: secondAction.payloadHash })).status).toBe(200);
      expect(await fixture.app.dispatch({ name: 'actions' })).toMatchObject([{ status: 'succeeded' }, { status: 'rejected' }]);
    } finally {
      events.close();
      await fixture.cleanup();
    }
  });

  it('signs in once with an HttpOnly cookie that reads, writes, and refuses a wrong token', async () => {
    const fixture = await webFixture();
    try {
      const signIn = (token: string) => fetch(fixture.baseUrl + '/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
      });
      const wrongSignIn = await signIn('wrong-token');
      expect(wrongSignIn.status).toBe(401);
      expect(wrongSignIn.headers.get('set-cookie')).toBeNull();

      const signInResponse = await signIn(fixture.token);
      expect(signInResponse.status).toBe(200);
      expect(await signInResponse.json()).toEqual({ signedIn: true });
      const sessionCookie = signInResponse.headers.get('set-cookie')!;
      expect(sessionCookie).toContain('HttpOnly');
      expect(sessionCookie).toContain('SameSite=Strict');
      expect(sessionCookie).toContain(`Max-Age=${400 * 24 * 60 * 60}`);

      const cookieHeader = { Cookie: sessionCookie.split(';')[0] };
      expect((await fetch(fixture.baseUrl + '/api/session', { headers: cookieHeader })).status).toBe(200);
      expect((await fetch(fixture.baseUrl + '/api/state', { headers: cookieHeader })).status).toBe(200);
      expect((await fetch(fixture.baseUrl, { headers: cookieHeader })).status).toBe(200);
      const sendWithCookie = await fetch(fixture.baseUrl + '/api/messages', {
        method: 'POST', headers: { ...cookieHeader, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Signed in by cookie' }),
      });
      expect(sendWithCookie.status).toBe(202);
      expect((await fetch(fixture.baseUrl + '/api/state', { headers: { Cookie: 'rahat_session=wrong-token' } })).status).toBe(401);
    } finally {
      await fixture.cleanup();
    }
  });

  it('keeps the token across restarts and replaces a damaged token file', async () => {
    const fixture = await webFixture();
    const tokenPath = join(fixture.config.dataDir, 'web-token');
    let restartedServer: Awaited<ReturnType<typeof startWebServer>> | undefined;
    try {
      await fixture.server.close();
      restartedServer = await startWebServer(fixture.app, 0);
      expect(readFileSync(tokenPath, 'utf8').trim()).toBe(fixture.token);
      await restartedServer.close();
      writeFileSync(tokenPath, 'not a token\n');
      restartedServer = await startWebServer(fixture.app, 0);
      expect(readFileSync(tokenPath, 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
      expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
    } finally {
      await restartedServer?.close();
      await fixture.app.stop();
      fixture.temporaryStorage.cleanup();
    }
  });

  it('reconnects to durable state after restarting the server and keeps the web token', async () => {
    const fixture = await webFixture();
    const firstEvents = await openEvents(fixture.baseUrl, fixture.token);
    let restartedApp: App | undefined;
    let restartedServer: Awaited<ReturnType<typeof startWebServer>> | undefined;
    try {
      const message = { message: 'Persist across restart', requestId: 'web-restart' };
      expect((await post(fixture.baseUrl, fixture.token, '/api/messages', message)).status).toBe(202);
      await firstEvents.nextState(state => conversationText(state).includes('Offline reply: Persist across restart'));
      firstEvents.close();
      await fixture.server.close();
      await fixture.app.close();
      restartedApp = await App.open(fixture.config);
      restartedServer = await startWebServer(restartedApp, fixture.server.port);
      const secondEvents = await openEvents(fixture.baseUrl, fixture.token);
      try {
        expect(conversationText(await secondEvents.nextState())).toContain('Offline reply: Persist across restart');
        expect(readFileSync(join(fixture.config.dataDir, 'web-token'), 'utf8').trim()).toBe(fixture.token);
        expect((await post(fixture.baseUrl, fixture.token, '/api/messages', message)).status).toBe(202);
        const state = await readState(fixture.baseUrl, fixture.token);
        expect(state.entries.flatMap(entry => entry.model).filter(message => message.role === 'user' && message.content === 'Persist across restart')).toHaveLength(1);
      } finally {
        secondEvents.close();
      }
    } finally {
      firstEvents.close();
      await restartedServer?.close();
      await restartedApp?.stop();
      await fixture.app.close();
      fixture.temporaryStorage.cleanup();
    }
  });

  it('renders subagents and escaped payloads and saves data/web-snapshot.html', async () => {
    const fixture = await webFixture();
    try {
      await fixture.app.dispatch({ name: 'chat', message: toolMessage('subagent_run', { task: 'Snapshot child answer', title: 'Snapshot child' }) });
      await fixture.app.dispatch({ name: 'chat', message: toolMessage('propose_send_message', { recipient: 'fixture:owner', body: '<script>alert("untrusted")</script>' }) });
      const state = await readState(fixture.baseUrl, fixture.token);
      expect(state.subagents).toMatchObject([{ title: 'Snapshot child', status: 'completed', answer: 'Offline reply: Snapshot child answer' }]);
      const snapshot = renderPage(state, true);
      expect(snapshot).toContain('&lt;script&gt;');
      expect(snapshot).not.toContain('<script>');
      expect(snapshot).not.toContain('src="/client.js"');
      expect(snapshot).toContain('Approve exact payload');
      const snapshotPath = join(process.cwd(), 'data/web-snapshot.html');
      writeFileSync(snapshotPath, snapshot, { mode: 0o600 });
      expect(readFileSync(snapshotPath, 'utf8')).toContain('Snapshot child');
    } finally {
      await fixture.cleanup();
    }
  });
});
