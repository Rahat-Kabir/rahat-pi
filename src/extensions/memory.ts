import { DatabaseSync } from 'node:sqlite';
import type { Memory } from '../harness/state.js';

// Rebuilt from authoritative Pi documents; a crash cannot leave stale facts searchable.
export class MemoryIndex {
  private database = new DatabaseSync(':memory:');
  constructor() {
    this.database.exec('CREATE VIRTUAL TABLE memory_fts USING fts5(id UNINDEXED, content, source UNINDEXED)');
  }
  search(memories: Record<string, Memory>, query: string): Memory[] {
    this.database.exec('DELETE FROM memory_fts');
    const insertMemory = this.database.prepare('INSERT INTO memory_fts VALUES (?, ?, ?)');
    for (const memory of Object.values(memories)) {
      insertMemory.run(memory.id, memory.content, memory.source);
    }
    const words = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
    if (words.length === 0) {
      return [];
    }
    const searchExpression = words.map(word => `"${word}"`).join(' OR ');
    const searchQuery = this.database.prepare('SELECT id FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT 20');
    const matchingRows = searchQuery.all(searchExpression);
    return matchingRows.map(matchingRow => memories[String(matchingRow.id)]);
  }
  close() {
    this.database.close();
  }
}
