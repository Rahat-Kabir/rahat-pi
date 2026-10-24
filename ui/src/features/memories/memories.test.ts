import { describe, expect, it } from 'vitest';
import { memoryCountLabel, memoryOrigin } from './memories';

describe('memories', () => {
  it('says where a memory came from and when', () => {
    const memory = { id: '7', content: 'Likes tea', source: 'owner', createdAt: Date.UTC(2026, 9, 24, 14, 5) };
    const origin = memoryOrigin(memory, 'en-GB');
    expect(origin.startsWith('From owner · ')).toBe(true);
    expect(origin).toContain('2026');
  });

  it('counts memories', () => {
    expect(memoryCountLabel(0)).toBe('0 memories');
    expect(memoryCountLabel(1)).toBe('1 memory');
    expect(memoryCountLabel(4)).toBe('4 memories');
  });
});
