import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { openFullySyncedDatabase } from '../src/harness/storage.js';
import { App } from '../src/harness/app.js';
import { offlineConfig, temporaryData, toolMessage } from './helpers.js';

const sqliteSynchronousFull = 2;

describe('Pi storage durability', () => {
  it('opens the Pi database with synchronous=FULL and WAL', async () => {
    const temporaryStorage = temporaryData();
    const database = await openFullySyncedDatabase(join(temporaryStorage.dataDir, 'pi.sqlite'));
    try {
      expect(await database.get<{ synchronous: number }>('PRAGMA synchronous'))
        .toEqual(expect.objectContaining({ synchronous: sqliteSynchronousFull }));
      expect(await database.get<{ journal_mode: string }>('PRAGMA journal_mode'))
        .toEqual(expect.objectContaining({ journal_mode: 'wal' }));
    } finally {
      await database.close();
      temporaryStorage.cleanup();
    }
  });

  it('keeps app state across a reopen on the fully synced storage', async () => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir);
    try {
      const firstApp = await App.open(config);
      await firstApp.dispatch({
        name: 'chat',
        message: toolMessage('memory_write', { content: 'Rahat prefers tea', source: 'owner' }),
      });
      await firstApp.close();
      const reopenedApp = await App.open(config);
      try {
        const state = await reopenedApp.dispatch({ name: 'state' }) as { memories: Record<string, { content: string }> };
        expect(Object.values(state.memories).map(memory => memory.content)).toEqual(['Rahat prefers tea']);
      } finally {
        await reopenedApp.close();
      }
    } finally {
      temporaryStorage.cleanup();
    }
  });
});
