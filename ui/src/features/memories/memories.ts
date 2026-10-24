import type { Memory } from '@api';

// One line under each memory: where the fact came from and when it was saved.
export function memoryOrigin(memory: Memory, locale?: string) {
  const savedAt = new Date(memory.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return `From ${memory.source} · ${savedAt}`;
}

export function memoryCountLabel(count: number) {
  return count === 1 ? '1 memory' : `${count} memories`;
}
