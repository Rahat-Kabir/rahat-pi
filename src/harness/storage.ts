import { openNodeSqliteDatabase, type NodeSqliteDatabase } from '@earendil-works/chord/sqlite/node';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';

// Chord opens SQLite with synchronous=NORMAL, which survives a process crash but can
// lose the newest commits on power loss or a host crash. An approval or a "succeeded"
// status must not silently disappear, so Pi's database runs with synchronous=FULL,
// matching the fake outbox.
export async function openFullySyncedDatabase(databasePath: string): Promise<NodeSqliteDatabase> {
  const database = await openNodeSqliteDatabase(databasePath);
  try {
    await database.exec('PRAGMA synchronous = FULL');
  } catch (error) {
    await database.close();
    throw error;
  }
  return database;
}

export async function openPiStorage(databasePath: string): Promise<SqliteStorage> {
  return SqliteStorage.open(await openFullySyncedDatabase(databasePath));
}
