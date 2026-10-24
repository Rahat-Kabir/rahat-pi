import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { SendPayload } from '../harness/state.js';
import { canonicalJson } from './actions.js';

export class FakeSender {
  private database: DatabaseSync;
  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS outbox (idempotency_key TEXT PRIMARY KEY, payload TEXT NOT NULL, receipt TEXT NOT NULL)
    `);
  }
  lookup(idempotencyKey: string): string | null {
    const outboxRow = this.database.prepare('SELECT receipt FROM outbox WHERE idempotency_key = ?').get(idempotencyKey);
    return outboxRow ? String(outboxRow.receipt) : null;
  }
  send(idempotencyKey: string, payload: SendPayload): string {
    const existingOutboxEntry = this.database.prepare('SELECT payload, receipt FROM outbox WHERE idempotency_key = ?').get(idempotencyKey);
    if (existingOutboxEntry) {
      if (existingOutboxEntry.payload !== canonicalJson(payload)) {
        throw new Error('Idempotency key payload mismatch');
      }
      return String(existingOutboxEntry.receipt);
    }
    const receipt = `fake:${randomUUID()}`;
    this.database.prepare('INSERT INTO outbox VALUES (?, ?, ?)').run(idempotencyKey, canonicalJson(payload), receipt);
    return receipt;
  }
  rows() {
    return this.database.prepare('SELECT * FROM outbox').all();
  }
  close() {
    this.database.close();
  }
}
