import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configFromEnv } from '../src/config.js';
import { renderPage } from '../src/web/page.js';
import type { WebState } from '../src/web/state.js';

const config = configFromEnv();
const response = await fetch(`http://127.0.0.1:${config.webPort}/api/state`);
if (!response.ok) {
  throw new Error(`Web state request failed: ${response.status}`);
}
const state = await response.json() as WebState;
const snapshotPath = join(config.dataDir, 'web-snapshot.html');
writeFileSync(snapshotPath, renderPage(state, true), { mode: 0o600 });
console.log(snapshotPath);
