import { expect, it, vi } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { Storage } from '@earendil-works/pi-durable';
import { App } from '../src/harness/app.js';
import * as modelSetup from '../src/harness/models.js';
import { offlineConfig, temporaryData, toolMessage } from './helpers.js';

it.each(['daily cap', 'run token cap', 'provider error', 'deadline'])(
  'excludes an unanswered %s turn and its partial entries while retaining durable history',
  async failure => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_COMPACT_AT_TOKENS: '40000' });
    const configuration = modelSetup.buildModels(config);
    const originalStream = configuration.models.streamSimple.bind(configuration.models);
    const streamSpy = vi.spyOn(configuration.models, 'streamSimple');
    const setupSpy = vi.spyOn(modelSetup, 'buildModels').mockReturnValue(configuration);
    let app = await App.open(config);
    const failedMessage = failure === 'daily cap' || failure === 'provider error'
      ? toolMessage('propose_send_message', { recipient: 'Alex', body: 'quarterly report is ready' })
      : toolMessage('memory_search', { query: 'Draft a message to Alex saying quarterly report is ready' });
    try {
      if (failure === 'daily cap') {
        config.dailyUsdCap = 0.001;
      } else if (failure === 'provider error') {
        streamSpy.mockImplementationOnce(() => { throw new Error('offline provider error'); });
      } else {
        streamSpy.mockImplementationOnce((model, transcript, options) => {
          // The first request succeeds with a tool call; the second request must fail.
          if (failure === 'run token cap') {
            config.maxRunTokens = 1;
          } else {
            config.now = () => Date.now() + config.maxRunMs * 2;
          }
          return originalStream(model, transcript, options);
        });
      }
      await expect(app.dispatch({ name: 'chat', message: failedMessage })).rejects.toThrow();
      await app.close();
      config.dailyUsdCap = 5;
      config.maxRunTokens = 64000;
      config.now = Date.now;
      app = await App.open(config);
      streamSpy.mockClear();
      await app.dispatch({ name: 'chat', message: 'what is 2 + 2?' });
      expect(streamSpy).toHaveBeenCalledTimes(1);
      const nextContext = streamSpy.mock.calls[0][1];
      expect(JSON.stringify(nextContext)).not.toContain('Alex');
      expect(JSON.stringify(nextContext.messages.filter(message => message.role !== 'system'))).not.toContain('memory_search');
      expect(JSON.stringify(nextContext)).toContain('what is 2 + 2?');
      expect(await app.dispatch({ name: 'actions' })).toEqual([]);
      const history = await app.root.entries({ order: 'ascending' }, 200, undefined, context);
      expect(JSON.stringify(history.items)).toContain('Alex');
      expect(history.items.some(entry => entry.kind === 'rahat.unanswered-context')).toBe(true);
      const activeContext = await app.root.context(context);
      expect(JSON.stringify(activeContext.messages)).not.toContain('Alex');
      if (failure === 'run token cap' || failure === 'deadline') {
        const failedToolEntries = history.items.filter(entry => entry.model?.some(message => message.role === 'toolResult'));
        expect(failedToolEntries.length).toBeGreaterThan(0);
      }
      await app.dispatch({ name: 'compact' });
      expect(JSON.stringify((await app.root.context(context)).messages)).not.toContain('Alex');
    } finally {
      await app.close();
      setupSpy.mockRestore();
      temporaryStorage.cleanup();
    }
  },
);

it('stops re-reading history once failed turns are cleaned up, and rescans after a new failure', async () => {
  const temporaryStorage = temporaryData();
  const config = offlineConfig(temporaryStorage.dataDir);
  const app = await App.open(config);
  const storage = (app as unknown as { storage: Storage }).storage;
  const scanSpy = vi.spyOn(storage, 'scanEntries');
  // The cleanup's full-history read: ascending pages of 200 for one conversation.
  const historyScans = () => scanSpy.mock.calls.filter(([query, limit]) => limit === 200 && query.order === 'ascending');
  const failOnDailyCap = async (message: string) => {
    config.dailyUsdCap = 0.001;
    await expect(app.dispatch({ name: 'chat', message })).rejects.toThrow('Daily USD cap reached');
    config.dailyUsdCap = 5;
  };
  try {
    await failOnDailyCap('Draft a message to Alex');
    await app.dispatch({ name: 'chat', message: 'first healthy message' });
    expect(historyScans().length).toBeGreaterThan(0);

    scanSpy.mockClear();
    await app.dispatch({ name: 'chat', message: 'second healthy message' });
    await app.dispatch({ name: 'chat', message: 'third healthy message' });
    expect(historyScans()).toHaveLength(0);

    await failOnDailyCap('Draft a message to Sam');
    await app.dispatch({ name: 'chat', message: 'after the second failure' });
    expect(historyScans().length).toBeGreaterThan(0);
    expect(JSON.stringify((await app.root.context(context)).messages)).not.toContain('Sam');
  } finally {
    vi.restoreAllMocks();
    await app.close();
    temporaryStorage.cleanup();
  }
});

it('compacts directly after failure without summarizing it or later omitting the healthy summary', async () => {
  const temporaryStorage = temporaryData();
  const config = offlineConfig(temporaryStorage.dataDir);
  const app = await App.open(config);
  try {
    await app.dispatch({ name: 'chat', message: 'ORCHID is the project codename. '.repeat(100) });
    await app.dispatch({ name: 'chat', message: 'Continue the project tomorrow. '.repeat(100) });
    config.dailyUsdCap = 0.001;
    await expect(app.dispatch({ name: 'chat', message: 'Draft a message to Alex' })).rejects.toThrow('Daily USD cap reached');
    config.dailyUsdCap = 5;
    expect(await app.dispatch({ name: 'compact' })).toMatchObject({ compacted: true });
    const compactedContext = await app.root.context(context);
    expect(JSON.stringify(compactedContext.messages)).not.toContain('Alex');
    expect(JSON.stringify(compactedContext.head)).toContain('ORCHID');
    await app.dispatch({ name: 'chat', message: 'what is 2 + 2?' });
    const nextContext = await app.root.context(context);
    expect(JSON.stringify(nextContext.messages)).not.toContain('Alex');
    expect(JSON.stringify(nextContext.messages)).toContain('ORCHID');
    const history = await app.root.entries({}, 200, undefined, context);
    expect(history.items.filter(entry => entry.kind === 'rahat.unanswered-context')).toHaveLength(1);
  } finally {
    await app.close();
    temporaryStorage.cleanup();
  }
});
