import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { App } from '../harness/app.js';
import { AppDoc } from '../harness/state.js';
import { readWebState } from './state.js';
import { renderPage, renderState } from './page.js';
import { appIsBuilt, defaultAppDirectory, findAppFile, isAppPath } from './app-files.js';

const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  // 'unsafe-inline' serves the old page's <style> block and React style attributes.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}
async function readBody(incomingRequest: IncomingMessage): Promise<Record<string, unknown>> {
  if (incomingRequest.headers['content-type'] !== 'application/json') {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  incomingRequest.setEncoding('utf8');
  let body = '';
  let bodyBytes = 0;
  for await (const chunk of incomingRequest) {
    bodyBytes += Buffer.byteLength(chunk);
    if (bodyBytes > 65536) {
      throw new HttpError(413, 'Request too large');
    }
    body += chunk;
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    throw new HttpError(400, 'Expected a JSON object');
  }
  return parsedBody as Record<string, unknown>;
}
function requireString(body: Record<string, unknown>, name: string, maximumLength: number) {
  const value = body[name];
  if (typeof value !== 'string' || !value.trim() || value.length > maximumLength) {
    throw new HttpError(400, `Invalid ${name}`);
  }
  return value;
}

// The token survives restarts so signed-in devices stay signed in.
// Deleting data/web-token and restarting signs every device out.
function loadOrCreateToken(tokenPath: string) {
  const savedToken = existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : '';
  const token = /^[0-9a-f]{64}$/.test(savedToken) ? savedToken : randomBytes(32).toString('hex');
  writeFileSync(tokenPath, token + '\n', { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
  return token;
}
function readCookie(incomingRequest: IncomingMessage, name: string) {
  for (const cookie of (incomingRequest.headers.cookie ?? '').split(';')) {
    const [cookieName, ...valueParts] = cookie.trim().split('=');
    if (cookieName === name) {
      return valueParts.join('=');
    }
  }
  return undefined;
}

const sessionCookieName = 'rahat_session';
// 400 days is the longest cookie lifetime browsers accept.
const sessionMaxAgeSeconds = 400 * 24 * 60 * 60;

export async function startWebServer(app: App, port = app.config.webPort, appDirectory = defaultAppDirectory) {
  const token = loadOrCreateToken(join(app.config.dataDir, 'web-token'));
  const matchesToken = (suppliedToken: unknown) => typeof suppliedToken === 'string'
    && Buffer.byteLength(suppliedToken) === token.length
    && timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(token));
  // The app signs in with the cookie; scripts and the old page's POSTs may send the header.
  const isSignedIn = (incomingRequest: IncomingMessage) =>
    matchesToken(incomingRequest.headers['x-rahat-token']) || matchesToken(readCookie(incomingRequest, sessionCookieName));
  const clientScript = readFileSync(new URL('./client.js', import.meta.url));
  const conversationView = await app.root.viewState(context);
  const actionsWatch = await app.harness.watchDoc(AppDoc, context);
  const clients = new Set<ServerResponse>();
  let refreshWork: Promise<void> = Promise.resolve();
  let closed = false;
  const refresh = () => {
    refreshWork = refreshWork.then(async () => {
      if (closed || clients.size === 0) {
        return;
      }
      const state = await readWebState(app, conversationView.value);
      const frame = `event: state\ndata: ${JSON.stringify({ ...state, html: renderState(state) })}\n\n`;
      for (const response of clients) {
        if (response.writableLength > 1024 * 1024) {
          // Slow clients reconnect to a fresh durable snapshot instead of buffering history.
          response.destroy();
        } else {
          response.write(frame);
        }
      }
    }).catch(error => {
      console.error(`Web state update failed: ${error.message}`);
      for (const response of clients) {
        response.destroy();
      }
    });
    return refreshWork;
  };
  const unsubscribe = conversationView.subscribe(refresh);
  actionsWatch?.start(refresh);
  let actualPort = port;
  async function handleRequest(incomingRequest: IncomingMessage, response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', contentSecurityPolicy);
    const allowedHosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
    if (!allowedHosts.includes(incomingRequest.headers.host ?? '')) {
      throw new HttpError(403, 'Host is not allowed');
    }
    const path = incomingRequest.url;
    // Signing in, the old page's script, and the app's files carry no owner data, so they are public.
    if (incomingRequest.method === 'POST' && path === '/api/session') {
      const body = await readBody(incomingRequest);
      if (!matchesToken(body.token)) {
        throw new HttpError(401, 'Wrong web token; paste the contents of data/web-token');
      }
      // HttpOnly keeps the token away from page scripts; SameSite=Strict keeps other sites from using it.
      response.setHeader('Set-Cookie',
        `${sessionCookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionMaxAgeSeconds}`);
      sendJson(response, 200, { signedIn: true });
      return;
    }
    if (incomingRequest.method === 'GET') {
      if (path === '/client.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        response.end(clientScript);
        return;
      }
      const pathname = new URL(path ?? '/', 'http://localhost').pathname;
      if (isAppPath(pathname)) {
        if (!appIsBuilt(appDirectory)) {
          throw new HttpError(404, 'App not built; run npm run ui:build');
        }
        const appFile = findAppFile(appDirectory, pathname === '/app' ? '/app/' : pathname);
        if (!appFile) {
          throw new HttpError(404, 'Not found');
        }
        response.writeHead(200, { 'Content-Type': appFile.contentType });
        response.end(readFileSync(appFile.path));
        return;
      }
    }
    if (!isSignedIn(incomingRequest)) {
      if (incomingRequest.method === 'GET' && path === '/') {
        response.writeHead(303, { Location: '/app/' });
        response.end();
        return;
      }
      throw new HttpError(401, 'Sign in required; paste the contents of data/web-token in the app');
    }
    if (incomingRequest.method === 'GET') {
      if (path === '/api/session') {
        sendJson(response, 200, { signedIn: true });
        return;
      }
      if (path === '/api/events') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
        response.write('retry: 1000\n\n');
        clients.add(response);
        response.once('close', () => clients.delete(response));
        await refresh();
        return;
      }
      if (path === '/' || path === '/api/state') {
        const state = await readWebState(app, conversationView.value);
        if (path === '/api/state') {
          sendJson(response, 200, state);
        } else {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end(renderPage(state));
        }
        return;
      }
      throw new HttpError(404, 'Not found');
    }
    if (incomingRequest.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed');
    }
    const body = await readBody(incomingRequest);
    if (path === '/api/messages') {
      const message = requireString(body, 'message', 16000);
      const whenBusy = body.whenBusy ?? 'followUp';
      if (whenBusy !== 'steer' && whenBusy !== 'followUp') {
        throw new HttpError(400, 'Invalid whenBusy');
      }
      const requestId = body.requestId === undefined ? undefined : requireString(body, 'requestId', 200);
      const result = await app.submitMessage(message, whenBusy, requestId);
      sendJson(response, 202, result);
      return;
    }
    if (path === '/api/actions') {
      const id = requireString(body, 'id', 200);
      const payloadHash = requireString(body, 'payloadHash', 64);
      const decision = body.decision;
      if (decision !== 'approve' && decision !== 'reject') {
        throw new HttpError(400, 'Invalid decision');
      }
      const result = await app.dispatch({ name: decision, id, payloadHash });
      sendJson(response, 200, result);
      return;
    }
    if (path === '/api/memories/forget') {
      const id = requireString(body, 'id', 200);
      sendJson(response, 200, await app.dispatch({ name: 'forget', id }));
      return;
    }
    throw new HttpError(404, 'Not found');
  }
  const server = createServer((incomingRequest, response) => {
    void handleRequest(incomingRequest, response).catch(error => {
      if (response.headersSent) {
        response.destroy();
      } else {
        sendJson(response, error instanceof HttpError ? error.status : 409, { error: error.message });
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch (error) {
    unsubscribe();
    conversationView.dispose();
    await actionsWatch?.stop();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Web listener has no TCP address');
  }
  actualPort = address.port;
  const heartbeat = setInterval(() => {
    for (const response of clients) {
      if (!response.write(': heartbeat\n\n')) {
        response.destroy();
      }
    }
  }, 15000);
  return {
    port: actualPort,
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      conversationView.dispose();
      await actionsWatch?.stop();
      await refreshWork;
      const closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closing;
    },
  };
}
