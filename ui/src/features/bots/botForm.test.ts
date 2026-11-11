import { describe, expect, it } from 'vitest';
import { buildCreateBotRequest } from './botForm';

describe('create-bot form', () => {
  it('builds a request from trimmed values and drops a blank persona', () => {
    expect(buildCreateBotRequest(' Watcher ', '  Speaks briefly. ', 'helper')).toEqual({
      request: { name: 'Watcher', persona: 'Speaks briefly.', model: 'helper' },
    });
    expect(buildCreateBotRequest('Plain', '   ', 'main')).toEqual({
      request: { name: 'Plain', model: 'main' },
    });
  });

  it('refuses a missing name, an over-long persona, and an unknown model', () => {
    expect(buildCreateBotRequest('  ', 'x', 'main')).toEqual({ error: 'Name the bot first.' });
    expect(buildCreateBotRequest('Chatty', 'x'.repeat(2001), 'main')).toEqual({ error: 'The persona must be at most 2000 characters.' });
    expect(buildCreateBotRequest('Turbo', 'x', 'turbo')).toEqual({ error: 'Pick the main or the helper model.' });
  });
});
