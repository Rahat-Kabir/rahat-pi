import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { configFromEnv } from '../src/config.js';

export function temporaryData() {
  mkdirSync('data', { recursive: true });
  const dataDir = mkdtempSync(resolve('data/test-'));
  return { dataDir, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}
// Tests run in a fixed UTC+06:00 zone (Etc/GMT-6; POSIX signs are inverted) so the
// expected routine times and daily-cap boundaries do not depend on the defaults.
export const testOwnerName = 'Test Owner';
export const testTimezone = 'Etc/GMT-6';
export const testUtcOffsetMs = 6 * 3600000;
const testIdentity = { RAHAT_PI_OWNER_NAME: testOwnerName, RAHAT_PI_TIMEZONE: testTimezone };

export function offlineConfig(dataDir: string, overrides: Record<string, string> = {}) {
  return configFromEnv({ RAHAT_PI_DATA_DIR: dataDir, RAHAT_PI_OFFLINE: '1', ...testIdentity, ...overrides });
}
export async function cli(dataDir: string, commandArguments: string[], overrides: Record<string, string> = {}) {
  const cliProcess = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...commandArguments], {
    cwd: resolve('.'), env: { ...process.env, OPENROUTER_API_KEY: '', RAHAT_PI_OFFLINE: '1', RAHAT_PI_DATA_DIR: dataDir, RAHAT_PI_CRASH_AT: '', RAHAT_PI_NOW: '', ...testIdentity, ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  cliProcess.stdout.on('data', chunk => {
    stdout += chunk;
  });
  cliProcess.stderr.on('data', chunk => {
    stderr += chunk;
  });
  const timeout = setTimeout(() => cliProcess.kill('SIGKILL'), 15000);
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveResult, reject) => {
    cliProcess.once('error', reject);
    cliProcess.once('close', (code, signal) => resolveResult({ code, signal }));
  });
  clearTimeout(timeout);
  if (result.code !== 0 && result.signal !== 'SIGKILL') {
    throw new Error(`CLI failed: ${stderr}\n${stdout}`);
  }
  return { ...result, stdout, stderr };
}
export const toolMessage = (toolName: string, toolArguments: object) => ['/tool', toolName, JSON.stringify(toolArguments)].join(' ');
export const jsonOutput = (result: { stdout: string }) => JSON.parse(result.stdout);
