import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { existsSync, unlinkSync, chmodSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { App, type Command, type Output } from './harness/app.js';
import { configFromEnv, type Config } from './config.js';
import { startWebServer } from './web/server.js';

export const socketPath = (config: Config) => join(config.dataDir, 'agent.sock');
export async function remoteCommand(config: Config, command: Command, output: Output): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const outgoingRequest = request({ socketPath: socketPath(config), method: 'POST', path: '/' }, response => {
      let bufferedResponse = '';
      let result: unknown;
      let failure: Error | undefined;
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        bufferedResponse += chunk;
        let newlineIndex: number;
        while ((newlineIndex = bufferedResponse.indexOf('\n')) >= 0) {
          const eventLine = bufferedResponse.slice(0, newlineIndex);
          bufferedResponse = bufferedResponse.slice(newlineIndex + 1);
          const event = JSON.parse(eventLine);
          if (event.type === 'text' || event.type === 'tool') {
            output(event);
          } else if (event.type === 'error') {
            failure = new Error(event.message);
          } else if (event.type === 'result') {
            result = event.value;
          }
        }
      });
      response.on('end', () => failure ? reject(failure) : resolve(result));
      response.on('error', reject);
    });
    outgoingRequest.on('error', reject);
    outgoingRequest.end(JSON.stringify(command));
  });
}
async function handleOwnerRequest(app: App, incomingRequest: IncomingMessage, response: ServerResponse) {
  response.setHeader('Content-Type', 'application/x-ndjson');
  try {
    let body = '';
    for await (const chunk of incomingRequest) {
      body += chunk;
      if (Buffer.byteLength(body) > 65536) {
        throw new Error('Owner request too large');
      }
    }
    const command = JSON.parse(body) as Command;
    const value = await app.dispatch(command, event => response.write(JSON.stringify(event) + '\n'));
    response.end(JSON.stringify({ type: 'result', value }) + '\n');
  } catch (error) {
    response.end(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) }) + '\n');
  }
}

export async function runService(config = configFromEnv(), enableWeb = false) {
  const app = await App.open(config);
  const stopPath = join(config.dataDir, 'stop');
  if (existsSync(stopPath)) {
    unlinkSync(stopPath);
  }
  const socketAddress = socketPath(config);
  // Kernel processLock is already held before removing a stale socket.
  if (existsSync(socketAddress)) {
    unlinkSync(socketAddress);
  }
  const server = createServer((incomingRequest, response) => handleOwnerRequest(app, incomingRequest, response));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketAddress, resolve);
  });
  chmodSync(socketAddress, 0o600);
  let webServer: Awaited<ReturnType<typeof startWebServer>> | undefined;
  try {
    if (enableWeb) {
      webServer = await startWebServer(app);
      console.log(`Web UI: http://127.0.0.1:${webServer.port} (token: ${join(config.dataDir, 'web-token')})`);
    }
  } catch (error) {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await app.close();
    throw error;
  }
  let stopping = false;
  const requestStop = () => {
    stopping = true;
  };
  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);
  console.log(`Rahat-PI service ready (${config.offline ? 'offline faux model' : config.model})`);
  try {
    await app.startBackground();
    app.harness.resume();
    while (!stopping && !app.stopRequested) {
      await app.executor.tick();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } finally {
    await webServer?.close();
    await app.stop();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    process.removeListener('SIGINT', requestStop);
    process.removeListener('SIGTERM', requestStop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runService().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
