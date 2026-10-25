import { DatabaseSync } from 'node:sqlite';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const backupKeepCount = 14;
export const backupIntervalMs = 24 * 60 * 60 * 1000;
const databaseFiles = ['pi.sqlite', 'fake-provider.sqlite'];
const copiedEntries = ['workspace', 'web-token'];
// Folder names sort by time: 2026-10-24T21-30-00-000Z.
const backupNamePattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

export function backupsDirectory(dataDir: string) {
  return join(dataDir, 'backups');
}

export function listBackups(dataDir: string) {
  const directory = backupsDirectory(dataDir);
  return existsSync(directory) ? readdirSync(directory).filter(name => backupNamePattern.test(name)).sort() : [];
}

export function newestBackupTime(dataDir: string) {
  const newest = listBackups(dataDir).at(-1);
  if (newest === undefined) {
    return undefined;
  }
  const [day, time] = newest.split('T');
  const [hours, minutes, seconds, milliseconds] = time.slice(0, -1).split('-');
  return Date.parse(`${day}T${hours}:${minutes}:${seconds}.${milliseconds}Z`);
}

// Copies the databases while the agent runs: VACUUM INTO reads one consistent snapshot,
// including commits still in the WAL. A crash mid-backup leaves only a `.partial` folder.
export function createBackup(dataDir: string, now = Date.now()) {
  const directory = backupsDirectory(dataDir);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const name = new Date(now).toISOString().replace(/[:.]/g, '-');
  const partialPath = join(directory, `${name}.partial`);
  const finalPath = join(directory, name);
  // Only one process owns the data folder, so any partial folder is left from a crash.
  for (const leftover of readdirSync(directory).filter(entry => entry.endsWith('.partial'))) {
    rmSync(join(directory, leftover), { recursive: true, force: true });
  }
  mkdirSync(partialPath, { mode: 0o700 });
  for (const databaseFile of databaseFiles) {
    const sourcePath = join(dataDir, databaseFile);
    if (!existsSync(sourcePath)) {
      continue;
    }
    const copyPath = join(partialPath, databaseFile);
    const source = new DatabaseSync(sourcePath, { readOnly: true });
    try {
      source.prepare('VACUUM INTO ?').run(copyPath);
    } finally {
      source.close();
    }
    const copy = new DatabaseSync(copyPath, { readOnly: true });
    try {
      const check = copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      if (check.integrity_check !== 'ok') {
        throw new Error(`Backup of ${databaseFile} failed its integrity check: ${check.integrity_check}`);
      }
    } finally {
      copy.close();
    }
  }
  for (const entry of copiedEntries) {
    if (existsSync(join(dataDir, entry))) {
      cpSync(join(dataDir, entry), join(partialPath, entry), { recursive: true, preserveTimestamps: true });
    }
  }
  renameSync(partialPath, finalPath);
  pruneBackups(dataDir);
  return { backup: finalPath, kept: listBackups(dataDir).length };
}

export function pruneBackups(dataDir: string, keepCount = backupKeepCount) {
  const backups = listBackups(dataDir);
  for (const oldBackup of backups.slice(0, Math.max(0, backups.length - keepCount))) {
    rmSync(join(backupsDirectory(dataDir), oldBackup), { recursive: true, force: true });
  }
}
