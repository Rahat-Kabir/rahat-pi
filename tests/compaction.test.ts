import { describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { CompactionEntry, UsageDoc } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { App } from '../src/harness/app.js';
import { AppDoc } from '../src/harness/state.js';
import { configFromEnv } from '../src/config.js';
import { budgetCompactionModels, buildModels } from '../src/harness/models.js';
import * as modelSetup from '../src/harness/models.js';
import { cli, jsonOutput, offlineConfig, temporaryData, testOwnerName, testTimezone, toolMessage } from './helpers.js';

async function seedConversation(app: App) {
  await app.dispatch({ name: 'chat', message: 'My project codename is ORCHID.' });
  await app.dispatch({ name: 'chat', message: toolMessage('memory_write', { content: 'Rahat prefers tea without sugar', source: 'owner:cli' }) });
  await app.dispatch({ name: 'chat', message: 'My project codename is ORCHID. '.repeat(100) });
  await app.dispatch({ name: 'chat', message: 'Continue the project tomorrow. '.repeat(100) });
}

describe('budgeted conversation compaction', () => {
  it('validates thresholds and defaults the summary model to the cheap model', () => {
    expect(configFromEnv({}).summaryModel).toBe('anthropic/claude-haiku-5.5');
    expect(configFromEnv({}).compactAtTokens).toBe(40000);
    expect(configFromEnv({}).maxRunTokens).toBe(300000);
    expect(configFromEnv({}).maxOutputTokens).toBe(8000);
    expect(configFromEnv({ RAHAT_PI_SUBAGENT_MODEL: 'cheap' }).summaryModel).toBe('cheap');
    expect(configFromEnv({ RAHAT_PI_SUMMARY_MODEL: 'summary' }).summaryModel).toBe('summary');
    for (const invalidThreshold of ['0', '-1', '1.5', 'NaN']) {
      expect(() => configFromEnv({ RAHAT_PI_COMPACT_AT_TOKENS: invalidThreshold })).toThrow();
    }
    expect(() => buildModels({ ...configFromEnv({}), summaryModel: 'missing' })).toThrow('Unknown OpenRouter summary model');
  });

  it('routes completeSimple to the summary model only after reservation and caps output', async () => {
    const models = createModels();
    const fauxModelProvider = fauxProvider({ models: [{ id: 'main' }, { id: 'summary' }], tokensPerSecond: Infinity });
    models.setProvider(fauxModelProvider.provider);
    fauxModelProvider.setResponses([(_transcript, options) => {
      expect(options?.maxTokens).toBe(123);
      return fauxAssistantMessage('Summary');
    }]);
    const mainModel = models.getModel('faux', 'main')!;
    const summaryModel = models.getModel('faux', 'summary')!;
    const transcript = { messages: [] };
    const beforeDispatch = vi.fn(async () => {
      expect(fauxModelProvider.state.callCount).toBe(0);
    });
    const guardedModels = budgetCompactionModels(models, summaryModel, 123, beforeDispatch);
    const result = await guardedModels.completeSimple(mainModel, transcript, { sessionId: 'summary-session' });
    expect(beforeDispatch).toHaveBeenCalledWith(summaryModel, transcript, 'summary-session');
    expect(result.model).toBe('summary');
  });

  it('preserves memory, profile, key conversation facts, and all stored entries after manual compaction', async () => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_COMPACT_AT_TOKENS: '8000' });
    const modelConfiguration = buildModels(config);
    const setupSpy = vi.spyOn(modelSetup, 'buildModels').mockReturnValue(modelConfiguration);
    const streamSpy = vi.spyOn(modelConfiguration.models, 'streamSimple');
    const app = await App.open(config);
    try {
      await seedConversation(app);
      const previousState = (await app.harness.snapshot(AppDoc, context))!;
      const previousEntries = (await app.root.entries({}, 1000, undefined, context)).items;
      expect(await app.dispatch({ name: 'compact' })).toMatchObject({ compacted: true });
      const state = (await app.harness.snapshot(AppDoc, context))!;
      expect(state.memories).toEqual(previousState.memories);
      expect(Object.values(state.dailyReservations)[0]).toBeGreaterThan(Object.values(previousState.dailyReservations)[0]);
      const summaryBudgets = Object.entries(state.budgets).filter(([budgetId]) => budgetId.startsWith('compaction:'));
      expect(summaryBudgets).toHaveLength(1);
      const tokensReserved = summaryBudgets[0][1].tokensReserved;
      expect(tokensReserved).toBeGreaterThan(4096);
      const expectedUsdReservation = ((tokensReserved - app.config.maxOutputTokens) * 3 + app.config.maxOutputTokens * 15) / 1000000;
      expect(Object.values(state.dailyReservations)[0] - Object.values(previousState.dailyReservations)[0]).toBeCloseTo(expectedUsdReservation, 10);
      const entries = (await app.root.entries({}, 1000, undefined, context)).items;
      expect(entries.filter(entry => !CompactionEntry.is(entry))).toEqual(previousEntries);
      const view = await app.root.context(context);
      expect(CompactionEntry.is(view.head)).toBe(true);
      expect(JSON.stringify(view.head)).toContain('ORCHID');
      expect(await app.dispatch({ name: 'chat', message: toolMessage('memory_search', { query: 'tea' }) })).toMatchObject({ reply: expect.stringContaining('tea without sugar') });
      expect(await app.dispatch({ name: 'chat', message: 'hello again' })).toMatchObject({ reply: 'Offline reply: hello again' });
      const lastTranscript = streamSpy.mock.lastCall![1];
      expect(JSON.stringify(lastTranscript.messages)).toContain(testOwnerName);
      expect(JSON.stringify(lastTranscript.messages)).toContain(testTimezone);
      expect((await app.harness.snapshot(UsageDoc, app.root.id, context))?.models['faux/faux-1']).toBeDefined();
    } finally {
      await app.close();
      streamSpy.mockRestore();
      setupSpy.mockRestore();
      temporaryStorage.cleanup();
    }
  });

  it('automatically compacts at the configured threshold and continues the input once', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_COMPACT_AT_TOKENS: '1500' }));
    try {
      await seedConversation(app);
      expect(await app.dispatch({ name: 'chat', message: 'after threshold' })).toMatchObject({ reply: 'Offline reply: after threshold' });
      const entries = (await app.root.entries({}, 1000, undefined, context)).items;
      expect(entries.filter(entry => CompactionEntry.is(entry) && entry.data.reason === 'threshold').length).toBeGreaterThan(0);
      const inputs = entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'user' && message.content === 'after threshold');
      expect(inputs).toHaveLength(1);
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it.each(['daily', 'tokens', 'stop'])('blocks compaction before provider dispatch at the %s limit and retains original context', async limitName => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_COMPACT_AT_TOKENS: '8000' });
    const modelConfiguration = buildModels(config);
    const setupSpy = vi.spyOn(modelSetup, 'buildModels').mockReturnValue(modelConfiguration);
    const modelSpy = vi.spyOn(modelConfiguration.models, 'completeSimple');
    const app = await App.open(config);
    try {
      await seedConversation(app);
      const previousEntries = (await app.root.entries({}, 1000, undefined, context)).items;
      modelSpy.mockClear();
      if (limitName === 'daily') {
        config.dailyUsdCap = 0.000000001;
      } else if (limitName === 'tokens') {
        config.maxRunTokens = 1;
      } else {
        writeFileSync(`${config.dataDir}/stop`, 'stop');
      }
      await expect(app.dispatch({ name: 'compact' })).rejects.toThrow();
      expect(modelSpy).not.toHaveBeenCalled();
      expect((await app.root.entries({}, 1000, undefined, context)).items).toEqual(previousEntries);
      const state = (await app.harness.snapshot(AppDoc, context))!;
      expect(Object.entries(state.budgets).filter(([budgetId]) => budgetId.startsWith('compaction:'))).toHaveLength(0);
    } finally {
      modelSpy.mockRestore();
      setupSpy.mockRestore();
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it.each(['length', 'error'] as const)('retains original context when the summarizer returns %s', async stopReason => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_COMPACT_AT_TOKENS: '8000' });
    const modelConfiguration = buildModels(config);
    const setupSpy = vi.spyOn(modelSetup, 'buildModels').mockReturnValue(modelConfiguration);
    const summarySpy = vi.spyOn(modelConfiguration.models, 'completeSimple');
    const app = await App.open(config);
    try {
      await seedConversation(app);
      const originalEntries = (await app.root.entries({}, 1000, undefined, context)).items;
      summarySpy.mockResolvedValue(fauxAssistantMessage('Incomplete summary', { stopReason }));
      await expect(app.dispatch({ name: 'compact' })).rejects.toThrow('Compaction failed');
      expect((await app.root.entries({}, 1000, undefined, context)).items).toEqual(originalEntries);
      const state = (await app.harness.snapshot(AppDoc, context))!;
      expect(Object.entries(state.budgets).find(([budgetId]) => budgetId.startsWith('compaction:'))?.[1].tokensReserved).toBeGreaterThan(4096);
      expect(await app.dispatch({ name: 'chat', message: 'continue after failure' })).toMatchObject({ reply: 'Offline reply: continue after failure' });
    } finally {
      await app.close();
      summarySpy.mockRestore();
      setupSpy.mockRestore();
      temporaryStorage.cleanup();
    }
  });

  it('replaces old model context with a concise summary while retaining facts', async () => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_COMPACT_AT_TOKENS: '8000' });
    const modelConfiguration = buildModels(config);
    const setupSpy = vi.spyOn(modelSetup, 'buildModels').mockReturnValue(modelConfiguration);
    const summarySpy = vi.spyOn(modelConfiguration.models, 'completeSimple');
    const app = await App.open(config);
    try {
      await seedConversation(app);
      const originalContext = await app.root.context(context);
      summarySpy.mockResolvedValue(fauxAssistantMessage('## Critical Context\nProject: ORCHID. Rahat prefers tea without sugar. Continue tomorrow.'));
      expect(await app.dispatch({ name: 'compact' })).toMatchObject({ compacted: true });
      const compactedContext = await app.root.context(context);
      expect(JSON.stringify(compactedContext.messages).length).toBeLessThan(JSON.stringify(originalContext.messages).length);
      expect(JSON.stringify(compactedContext.head)).toContain('ORCHID');
      expect(JSON.stringify(summarySpy.mock.lastCall![1])).toContain('ORCHID');
      expect(await app.dispatch({ name: 'chat', message: 'continue' })).toMatchObject({ reply: 'Offline reply: continue' });
    } finally {
      await app.close();
      summarySpy.mockRestore();
      setupSpy.mockRestore();
      temporaryStorage.cleanup();
    }
  });

  it('aborts an in-flight manual compaction at its wall deadline and keeps original history', async () => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_COMPACT_AT_TOKENS: '8000' });
    const modelConfiguration = buildModels(config);
    const setupSpy = vi.spyOn(modelSetup, 'buildModels').mockReturnValue(modelConfiguration);
    const summarySpy = vi.spyOn(modelConfiguration.models, 'completeSimple');
    const app = await App.open(config);
    try {
      await seedConversation(app);
      const originalEntries = (await app.root.entries({}, 1000, undefined, context)).items;
      config.maxRunMs = 150;
      summarySpy.mockImplementation(async (_model, _transcript, options) => {
        await new Promise<void>(resolve => {
          if (options?.signal?.aborted) {
            resolve();
          } else {
            options?.signal?.addEventListener('abort', () => resolve(), { once: true });
          }
        });
        return fauxAssistantMessage('Cancelled summary');
      });
      await expect(app.dispatch({ name: 'compact' })).rejects.toThrow('aborted');
      expect((await app.root.entries({}, 1000, undefined, context)).items).toEqual(originalEntries);
    } finally {
      await app.close();
      summarySpy.mockRestore();
      setupSpy.mockRestore();
      temporaryStorage.cleanup();
    }
  });

  it('compacts through the standalone CLI and continues chat across processes', async () => {
    const temporaryStorage = temporaryData();
    const overrides = { RAHAT_PI_COMPACT_AT_TOKENS: '8000' };
    const app = await App.open(offlineConfig(temporaryStorage.dataDir, overrides));
    try {
      await seedConversation(app);
      await app.close();
      expect(jsonOutput(await cli(temporaryStorage.dataDir, ['compact'], overrides))).toMatchObject({ compacted: true });
      const continuedChat = await cli(temporaryStorage.dataDir, ['chat', '--message', 'after standalone compaction'], overrides);
      expect(continuedChat.stdout).toContain('Offline reply: after standalone compaction');
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('refuses overlapping summary accounting and retains a consistent conversation', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_COMPACT_AT_TOKENS: '8000' }));
    try {
      await seedConversation(app);
      const originalEntries = (await app.root.entries({}, 1000, undefined, context)).items;
      const taskIds = await Promise.all([
        app.root.compact(undefined, context),
        app.root.compact(undefined, context),
      ]);
      const settledTasks = await Promise.all(taskIds.map(taskId => app.harness.waitForTask(taskId, context)));
      expect(settledTasks.some(settledTask => settledTask.state.outcome.status !== 'completed')).toBe(true);
      const entries = (await app.root.entries({}, 1000, undefined, context)).items;
      expect(entries.filter(entry => !CompactionEntry.is(entry))).toEqual(originalEntries);
      expect(entries.filter(entry => CompactionEntry.is(entry)).length).toBeLessThanOrEqual(1);
      expect(await app.dispatch({ name: 'chat', message: 'continue after overlapping summaries' })).toMatchObject({ reply: 'Offline reply: continue after overlapping summaries' });
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('returns a no-op for an empty conversation without reserving cost', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      expect(await app.dispatch({ name: 'compact' })).toMatchObject({ compacted: false });
      expect(Object.keys((await app.harness.snapshot(AppDoc, context))?.budgets ?? {})).toHaveLength(0);
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });
});
