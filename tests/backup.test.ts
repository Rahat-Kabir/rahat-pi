import { describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from '../src/harness/app.js';
import { backupKeepCount, backupsDirectory, createBackup, listBackups } from '../src/harness/backup.js';
import { cli, jsonOutput, offlineConfig, temporaryData, toolMessage } from './helpers.js';

const hourMs = 60 * 60 * 1000;

describe('backups', () => {
  it('backs up while the agent runs and restores into a fresh data folder', async () => {
    const original = temporaryData();
    const restored = temporaryData();
    const app = await App.open(offlineConfig(original.dataDir));
    // Subscribed browsers are bound to this key pair, so a restore must keep it.
    const pushPublicKey = app.notifier.keys.publicKey;
    try {
      await app.dispatch({ name: 'chat', message: toolMessage('memory_write', { content: 'Prefers green tea', source: 'owner' }) });
      await app.dispatch({ name: 'chat', message: toolMessage('workspace_write', { path: 'notes.txt', content: 'kept' }) });
      const { backup, kept } = await app.dispatch({ name: 'backup' }) as { backup: string; kept: number };
      expect(kept).toBe(1);
      // No web server ran here, so there is no web token to copy.
      expect(readdirSync(backup).sort()).toEqual(['fake-provider.sqlite', 'pi.sqlite', 'push-keys.json', 'workspace']);
      expect(statSync(backupsDirectory(original.dataDir)).mode & 0o777).toBe(0o700);
      cpSync(backup, restored.dataDir, { recursive: true });
    } finally {
      await app.close();
      original.cleanup();
    }
    const restoredApp = await App.open(offlineConfig(restored.dataDir));
    try {
      expect((await restoredApp.dispatch({ name: 'memories' }) as { content: string }[]).map(memory => memory.content)).toEqual(['Prefers green tea']);
      expect(readFileSync(join(restored.dataDir, 'workspace', 'notes.txt'), 'utf8')).toBe('kept');
      expect(restoredApp.notifier.keys.publicKey).toBe(pushPublicKey);
    } finally {
      await restoredApp.close();
      restored.cleanup();
    }
  });

  it(`keeps the newest ${backupKeepCount} and clears a backup a crash left unfinished`, async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      const firstDay = Date.UTC(2026, 0, 1);
      for (let day = 0; day < backupKeepCount + 2; day++) {
        createBackup(temporaryStorage.dataDir, firstDay + day * 24 * hourMs);
      }
      const leftover = join(backupsDirectory(temporaryStorage.dataDir), '2026-02-01T00-00-00-000Z.partial');
      mkdirSync(leftover);
      writeFileSync(join(leftover, 'pi.sqlite'), 'half written');
      createBackup(temporaryStorage.dataDir, firstDay + 100 * 24 * hourMs);
      const backups = listBackups(temporaryStorage.dataDir);
      expect(backups).toHaveLength(backupKeepCount);
      expect(backups[0]).toBe('2026-01-04T00-00-00-000Z');
      expect(backups.at(-1)).toBe('2026-04-11T00-00-00-000Z');
      expect(existsSync(leftover)).toBe(false);
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('backs up once a day from the service loop, checking at most hourly', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      const start = Date.UTC(2026, 0, 1);
      app.backupIfDue(start);
      expect(listBackups(temporaryStorage.dataDir)).toHaveLength(1);
      app.backupIfDue(start + 2 * hourMs);
      app.backupIfDue(start + 23 * hourMs);
      expect(listBackups(temporaryStorage.dataDir)).toHaveLength(1);
      app.backupIfDue(start + 24 * hourMs);
      expect(listBackups(temporaryStorage.dataDir)).toHaveLength(2);
      // Within the hour after a check, nothing is looked at, even when a backup would be due.
      app.backupIfDue(start + 24 * hourMs + 1);
      expect(listBackups(temporaryStorage.dataDir)).toHaveLength(2);
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('saves a backup on demand from the CLI', async () => {
    const temporaryStorage = temporaryData();
    try {
      await cli(temporaryStorage.dataDir, ['chat', '--message', toolMessage('memory_write', { content: 'From the CLI', source: 'owner' })]);
      const result = jsonOutput(await cli(temporaryStorage.dataDir, ['backup'])) as { backup: string; kept: number };
      expect(result.kept).toBe(1);
      expect(existsSync(join(result.backup, 'pi.sqlite'))).toBe(true);
    } finally {
      temporaryStorage.cleanup();
    }
  });
});
