import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:http';
import { App } from '../src/harness/app.js';
import { startWebServer } from '../src/web/server.js';
import { offlineConfig, temporaryData } from './helpers.js';

async function appFilesFixture(build: boolean) {
  const temporaryStorage = temporaryData();
  const config = offlineConfig(temporaryStorage.dataDir);
  const appDirectory = join(temporaryStorage.dataDir, 'ui-dist');
  if (build) {
    mkdirSync(join(appDirectory, 'assets'), { recursive: true });
    writeFileSync(join(appDirectory, 'index.html'), '<!doctype html><title>Rahat-PI app</title>');
    writeFileSync(join(appDirectory, 'assets', 'app.js'), 'console.log("app")');
    writeFileSync(join(appDirectory, 'assets', 'app.css'), 'body{}');
    writeFileSync(join(appDirectory, 'manifest.webmanifest'), '{}');
    writeFileSync(join(appDirectory, 'notes.txt'), 'unknown type');
  }
  // A file next to the app folder that traversal must never reach.
  writeFileSync(join(temporaryStorage.dataDir, 'secret.html'), 'secret');
  const app = await App.open(config);
  const server = await startWebServer(app, 0, appDirectory);
  return {
    port: server.port,
    token: readFileSync(join(config.dataDir, 'web-token'), 'utf8').trim(),
    async cleanup() {
      await server.close();
      await app.stop();
      temporaryStorage.cleanup();
    },
  };
}
// Raw requests keep the path exactly as written; fetch would normalize `..` away.
function rawGet(port: number, path: string, token = '') {
  return new Promise<{ status: number | undefined; contentType: string | undefined; body: string }>((resolve, reject) => {
    const outgoingRequest = request({ host: '127.0.0.1', port, path, headers: { 'X-Rahat-Token': token } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => body += chunk);
      response.once('end', () => resolve({ status: response.statusCode, contentType: response.headers['content-type'], body }));
    });
    outgoingRequest.once('error', reject);
    outgoingRequest.end();
  });
}

describe('built app files', () => {
  it('serves the built app at /app/ with matching content types', async () => {
    const fixture = await appFilesFixture(true);
    try {
      for (const path of ['/app', '/app/', '/app/index.html']) {
        const page = await rawGet(fixture.port, path);
        expect(page.status).toBe(200);
        expect(page.contentType).toBe('text/html; charset=utf-8');
        expect(page.body).toContain('Rahat-PI app');
      }
      expect((await rawGet(fixture.port, '/app/assets/app.js')).contentType).toBe('text/javascript; charset=utf-8');
      expect((await rawGet(fixture.port, '/app/assets/app.css')).contentType).toBe('text/css; charset=utf-8');
      expect((await rawGet(fixture.port, '/app/manifest.webmanifest')).contentType).toBe('application/manifest+json');
      expect((await rawGet(fixture.port, '/app/assets/app.js?version=1')).status).toBe(200);
      // The old page keeps working at / until the app replaces it.
      expect((await rawGet(fixture.port, '/', fixture.token)).body).toContain('Main conversation');
    } finally {
      await fixture.cleanup();
    }
  });

  it('refuses traversal, unknown file types, folders, and missing files', async () => {
    const fixture = await appFilesFixture(true);
    try {
      for (const path of [
        '/app/../secret.html',
        '/app/%2e%2e/secret.html',
        '/app/..%2fsecret.html',
        '/app/assets/..%2f..%2fsecret.html',
        '/app/%2Fetc%2Fpasswd.html',
        '/app/%00.html',
        '/app/%E0%A4%A.html',
        '/app/notes.txt',
        '/app/assets',
        '/app/missing.js',
        '/application',
      ]) {
        // Signed in, so only the file rules (not the sign-in check) can refuse these.
        const response = await rawGet(fixture.port, path, fixture.token);
        expect(response.status, path).toBe(404);
        expect(response.body, path).not.toContain('secret');
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it('explains how to build when the app is missing', async () => {
    const fixture = await appFilesFixture(false);
    try {
      const response = await rawGet(fixture.port, '/app/');
      expect(response.status).toBe(404);
      expect(JSON.parse(response.body).error).toContain('npm run ui:build');
    } finally {
      await fixture.cleanup();
    }
  });

  it('lets the app load its own scripts, styles, and manifest but nothing external', async () => {
    const fixture = await appFilesFixture(true);
    try {
      const response = await fetch(`http://127.0.0.1:${fixture.port}/app/`);
      const policy = response.headers.get('content-security-policy')!;
      expect(policy).toContain("default-src 'none'");
      expect(policy).toContain("script-src 'self'");
      expect(policy).toContain("style-src 'self'");
      expect(policy).toContain("manifest-src 'self'");
      expect(policy).not.toContain('http');
      expect(policy).not.toContain('*');
    } finally {
      await fixture.cleanup();
    }
  });
});
