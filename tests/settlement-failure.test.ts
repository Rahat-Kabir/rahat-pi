import { expect, it, vi } from 'vitest';
import { App } from '../src/harness/app.js';
import * as costs from '../src/harness/costs.js';
import { offlineConfig, temporaryData } from './helpers.js';

it('ends the reply and keeps chatting when cost settlement cannot be saved', async () => {
  const temporaryStorage = temporaryData();
  const settlementSpy = vi.spyOn(costs, 'finishRequest').mockRejectedValueOnce(new Error('simulated commit failure'));
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const app = await App.open(offlineConfig(temporaryStorage.dataDir));
  try {
    // Before the fix, a throwing settlement skipped closing the stream and this chat hung.
    expect(await app.dispatch({ name: 'chat', message: 'hello' })).toMatchObject({ reply: 'Offline reply: hello' });
    expect(settlementSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Cost settlement failed'));
    expect(await app.dispatch({ name: 'chat', message: 'again' })).toMatchObject({ reply: 'Offline reply: again' });
  } finally {
    vi.restoreAllMocks();
    await app.close();
    temporaryStorage.cleanup();
  }
});
