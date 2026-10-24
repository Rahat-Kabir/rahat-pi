import { describe, expect, it, vi } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { UsageDoc } from '@earendil-works/pi-durable';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import type { Usage } from '@earendil-works/pi-ai';
import { App } from '../src/harness/app.js';
import { BriefingTask } from '../src/extensions/routines.js';
import { AppDoc } from '../src/harness/state.js';
import { CostsDoc, recordRequestUsage } from '../src/harness/costs.js';
import { localDay } from '../src/timezone.js';
import { configFromEnv } from '../src/config.js';
import * as modelSetup from '../src/harness/models.js';
import { cli, jsonOutput, offlineConfig, temporaryData, testTimezone, toolMessage } from './helpers.js';

function reportedUsage(actualUsd: number): Usage {
  return {
    input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110,
    cost: { input: actualUsd / 2, output: actualUsd / 2, cacheRead: 0, cacheWrite: 0, total: actualUsd },
  };
}
function pricedFauxModels(config: ReturnType<typeof offlineConfig>, actualUsd = 0.01) {
  const configuration = modelSetup.buildModels(config);
  const originalStream = configuration.models.streamSimple.bind(configuration.models);
  vi.spyOn(configuration.models, 'streamSimple').mockImplementation((model, transcript, options) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      for await (const event of originalStream(model, transcript, options)) {
        if (event.type === 'done') {
          event.message.usage = reportedUsage(actualUsd);
        }
        stream.push(event);
      }
      stream.end();
    })();
    return stream;
  });
  const originalComplete = configuration.models.completeSimple.bind(configuration.models);
  vi.spyOn(configuration.models, 'completeSimple').mockImplementation(async (model, transcript, options) => {
    const message = await originalComplete(model, transcript, options);
    message.usage = reportedUsage(0.02);
    return message;
  });
  return configuration;
}

describe('cost and operational statistics', () => {
  it('prints empty readable and JSON stats without dispatching a model', async () => {
    const temporaryStorage = temporaryData();
    try {
      expect((await cli(temporaryStorage.dataDir, ['stats'])).stdout).toContain('Today: actual $0.000000 / open $0.000000 / unknown $0.000000 / counted $0.000000');
      const stats = jsonOutput(await cli(temporaryStorage.dataDir, ['stats', '--json']));
      expect(stats.total).toEqual({ actualUsd: 0, reservedUsd: 0, openReservedUsd: 0, unknownReservedUsd: 0, countedUsd: 0, requests: 0, unknownRequests: 0 });
      expect(stats.models).toEqual([]);
      expect(stats.tasks.total).toBe(0);
    } finally {
      temporaryStorage.cleanup();
    }
  });

  it('records reported USD for main, child, and compaction requests and preserves it on reopen', async () => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_COMPACT_AT_TOKENS: '8000' });
    const configuration = pricedFauxModels(config);
    const setupSpy = vi.spyOn(modelSetup, 'buildModels').mockReturnValue(configuration);
    let app = await App.open(config);
    try {
      await app.dispatch({ name: 'chat', message: 'ORCHID project details. '.repeat(100) });
      await app.dispatch({ name: 'chat', message: 'Continue tomorrow. '.repeat(100) });
      await app.dispatch({ name: 'chat', message: toolMessage('subagent_run', { task: 'Read only answer' }) });
      await app.dispatch({ name: 'compact' });
      const stats = await app.stats();
      expect(stats.models.map(model => model.role)).toEqual(['compaction', 'main', 'subagent']);
      expect(stats.models.find(model => model.role === 'main')?.total.actualUsd).toBeCloseTo(0.04);
      expect(stats.models.find(model => model.role === 'subagent')?.total.actualUsd).toBeCloseTo(0.01);
      expect(stats.models.find(model => model.role === 'compaction')?.total.actualUsd).toBeCloseTo(0.02);
      expect(stats.total.actualUsd).toBeCloseTo(0.07);
      expect(stats.piUsage.models['faux/faux-1'].cost.total).toBeCloseTo(0.07);
      expect(stats.total.unknownRequests).toBe(0);
      expect(stats.total.openReservedUsd).toBe(0);
      expect(stats.total.unknownReservedUsd).toBe(0);
      expect(stats.total.countedUsd).toBeCloseTo(0.07);
      expect(stats.total.reservedUsd).toBeGreaterThan(stats.total.actualUsd);
      expect(stats.subagents).toEqual({ total: 1, completed: 1 });
      await app.close();
      app = await App.open(config);
      expect(await app.stats()).toEqual(stats);
    } finally {
      await app.close();
      setupSpy.mockRestore();
      temporaryStorage.cleanup();
    }
  });

  it('uses local dates and refuses lifetime cap overages across midnight before provider dispatch', async () => {
    expect(localDay(Date.parse('2026-10-24T17:59:59Z'), testTimezone)).toBe('2026-10-24');
    expect(localDay(Date.parse('2026-10-24T18:00:00Z'), testTimezone)).toBe('2026-10-25');
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir);
    let now = Date.parse('2026-10-24T17:59:59Z');
    config.now = () => now;
    const configuration = pricedFauxModels(config);
    const streamSpy = vi.spyOn(configuration.models, 'streamSimple');
    const setupSpy = vi.spyOn(modelSetup, 'buildModels').mockReturnValue(configuration);
    const app = await App.open(config);
    try {
      await app.dispatch({ name: 'chat', message: 'first day' });
      const previousStats = await app.stats();
      const providerCalls = streamSpy.mock.calls.length;
      config.totalUsdCap = previousStats.total.countedUsd + 0.000000001;
      now += 1000;
      await expect(app.dispatch({ name: 'chat', message: 'second day' })).rejects.toThrow('Total USD cap reached');
      expect(streamSpy.mock.calls.length).toBe(providerCalls);
      const stats = await app.stats();
      expect(stats.today.actualUsd).toBe(0);
      expect(stats.today.reservedUsd).toBe(0);
      expect(stats.total).toEqual(previousStats.total);
      expect(stats.models[0].today.requests).toBe(0);
    } finally {
      await app.close();
      setupSpy.mockRestore();
      temporaryStorage.cleanup();
    }
  });

  it('retains legacy Pi spend without inventing a date or model role', async () => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir);
    let app = await App.open(config);
    try {
      await app.harness.commit(async transaction => {
        (await transaction.doc(UsageDoc, app.root.id)).models['legacy/model'] = reportedUsage(0.4);
        (await transaction.doc(CostsDoc)).baselineModels = null;
      }, context);
      await app.close();
      app = await App.open(config);
      await app.dispatch({ name: 'chat', message: 'new request' });
      const stats = await app.stats();
      expect(stats.total.actualUsd).toBeCloseTo(0.4);
      expect(stats.today.actualUsd).toBe(0);
      expect(stats.unattributedByModel['legacy/model']).toBe(0.4);
      expect(stats.models).toHaveLength(1);
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('counts failures by tool, all action statuses, aborted tasks, and paginated task records', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_MAX_RUN_TOKENS: '256000' }));
    try {
      await app.dispatch({ name: 'chat', message: toolMessage('workspace_read', { path: '../pi.sqlite' }) });
      await app.dispatch({ name: 'chat', message: toolMessage('calendar_list_events', { start: 'bad', end: 'bad' }) });
      const statuses = ['proposed', 'approved', 'executing', 'succeeded', 'failed', 'unknown', 'rejected'] as const;
      for (const status of statuses) {
        await app.dispatch({ name: 'chat', message: toolMessage('propose_send_message', { recipient: 'fixture:owner', body: status }) });
      }
      await app.harness.commit(async transaction => {
        const state = await transaction.doc(AppDoc);
        for (const [actionIndex, action] of Object.values(state.actions).entries()) {
          action.status = statuses[actionIndex];
        }
      }, context);
      const taskIds = await app.harness.commit(async transaction => {
        const taskIds = [];
        for (let taskIndex = 0; taskIndex < 205; taskIndex++) {
          taskIds.push(await transaction.createTask(BriefingTask, { routineId: `missing-${taskIndex}` }, { conversationId: app.root.id, ownership: { kind: 'conversation' } }));
        }
        return taskIds;
      }, context);
      await app.harness.abortTask(taskIds[0], context);
      await app.harness.waitForIdle(context);
      const stats = await app.stats();
      expect(stats.tasks.total).toBeGreaterThan(205);
      expect(stats.tasks.aborted).toBeGreaterThanOrEqual(1);
      expect(stats.toolFailures).toMatchObject({ workspace_read: 1, calendar_list_events: 1 });
      for (const status of statuses) {
        expect(stats.actions[status]).toBe(1);
      }
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('keeps unreported failures unknown and records reported error usage with settlement', async () => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir);
    const configuration = modelSetup.buildModels(config);
    const streamSpy = vi.spyOn(configuration.models, 'streamSimple');
    streamSpy.mockImplementationOnce(() => {
      throw new Error('No provider usage received');
    });
    streamSpy.mockImplementationOnce(() => {
      const stream = createAssistantMessageEventStream();
      const message = fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Reported provider error' });
      message.usage = reportedUsage(0.03);
      stream.push({ type: 'error', reason: 'error', error: message });
      stream.end();
      return stream;
    });
    const setupSpy = vi.spyOn(modelSetup, 'buildModels').mockReturnValue(configuration);
    const app = await App.open(config);
    try {
      await expect(app.dispatch({ name: 'chat', message: 'unreported' })).rejects.toThrow();
      const firstStats = await app.stats();
      expect(firstStats.total.unknownRequests).toBe(1);
      expect(firstStats.total.actualUsd).toBe(0);
      expect(firstStats.total.openReservedUsd).toBe(0);
      expect(firstStats.total.unknownReservedUsd).toBe(firstStats.total.reservedUsd);
      expect(firstStats.total.countedUsd).toBe(firstStats.total.unknownReservedUsd);
      await expect(app.dispatch({ name: 'chat', message: 'reported' })).rejects.toThrow();
      const stats = await app.stats();
      expect(stats.total.unknownRequests).toBe(1);
      expect(stats.total.requests).toBe(2);
      expect(stats.total.actualUsd).toBeCloseTo(0.03);
      expect(stats.total.countedUsd).toBeCloseTo(firstStats.total.countedUsd + 0.03);
      expect(stats.total.openReservedUsd).toBe(0);
      expect(stats.total.reservedUsd).toBeGreaterThan(firstStats.total.reservedUsd);
    } finally {
      await app.close();
      setupSpy.mockRestore();
      temporaryStorage.cleanup();
    }
  });

  it('charges reported overages against the lifetime cap before admitting another request', async () => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir);
    const app = await App.open(config);
    try {
      await app.dispatch({ name: 'chat', message: 'first' });
      const stats = await app.stats();
      config.totalUsdCap = stats.total.reservedUsd + 0.01;
      await app.harness.commit(async transaction => {
        const costs = await transaction.doc(CostsDoc);
        Object.values(costs.requests)[0].usage = reportedUsage(0.3);
      }, context);
      await expect(app.dispatch({ name: 'chat', message: 'second' })).rejects.toThrow('Total USD cap reached');
      expect((await app.stats()).total.requests).toBe(1);
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('counts restart-limit parking separately from tasks blocked on a missing definition', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      const taskId = await app.harness.commit(transaction => transaction.createTask(BriefingTask, { routineId: 'missing' }, { conversationId: app.root.id, ownership: { kind: 'conversation' } }), context);
      const record = (await app.harness.getTask(taskId, context))!;
      vi.spyOn(app.harness, 'inspect').mockResolvedValue({
        scheduling: 'paused',
        submissions: [],
        tasks: [
          { record, state: { kind: 'blocked', reason: 'restart_limit' } },
          { record, state: { kind: 'blocked', reason: 'missing_task' } },
        ],
      });
      expect((await app.stats()).tasks.parked).toBe(1);
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('settles many cheap turns while keeping the next request within both remaining caps', async () => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir, {
      RAHAT_PI_DAILY_USD_CAP: '0.15', RAHAT_PI_TOTAL_USD_CAP: '0.15',
      RAHAT_PI_COMPACT_AT_TOKENS: '40000',
    });
    const configuration = pricedFauxModels(config, 0.001);
    const setupSpy = vi.spyOn(modelSetup, 'buildModels').mockReturnValue(configuration);
    const app = await App.open(config);
    try {
      for (let turnIndex = 0; turnIndex < 30; turnIndex++) {
        await app.dispatch({ name: 'chat', message: `cheap turn ${turnIndex}` });
      }
      const stats = await app.stats();
      expect(stats.total.reservedUsd).toBeGreaterThan(config.dailyUsdCap);
      expect(stats.total.countedUsd).toBeCloseTo(0.03);
      expect(stats.today.countedUsd).toBeCloseTo(0.03);
      expect(stats.models[0].total.countedUsd).toBeCloseTo(0.03);
      expect(stats.total.openReservedUsd).toBe(0);
      expect(stats.total.unknownReservedUsd).toBe(0);
      config.dailyUsdCap = 0.031;
      await expect(app.dispatch({ name: 'chat', message: 'too large for remaining cap' })).rejects.toThrow('Daily USD cap reached');
      expect((await app.stats()).total).toEqual(stats.total);
    } finally {
      await app.close();
      setupSpy.mockRestore();
      temporaryStorage.cleanup();
    }
  });

  it('shows an open reservation during dispatch and settles reported usage idempotently', async () => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir);
    const configuration = modelSetup.buildModels(config);
    const stream = createAssistantMessageEventStream();
    let notifyDispatched!: () => void;
    const dispatched = new Promise<void>(resolve => { notifyDispatched = resolve; });
    vi.spyOn(configuration.models, 'streamSimple').mockImplementationOnce(() => {
      notifyDispatched();
      return stream;
    });
    const setupSpy = vi.spyOn(modelSetup, 'buildModels').mockReturnValue(configuration);
    const app = await App.open(config);
    try {
      const pendingTurn = app.dispatch({ name: 'chat', message: 'open reservation' });
      await dispatched;
      const openStats = await app.stats();
      expect(openStats.total.openReservedUsd).toBeGreaterThan(0);
      expect(openStats.total.countedUsd).toBe(openStats.total.openReservedUsd);
      expect(openStats.total.unknownReservedUsd).toBe(0);
      const message = fauxAssistantMessage('complete');
      message.usage = reportedUsage(0.001);
      stream.push({ type: 'done', reason: 'stop', message });
      stream.end();
      await pendingTurn;
      const settledStats = await app.stats();
      expect(settledStats.total.openReservedUsd).toBe(0);
      expect(settledStats.total.countedUsd).toBe(0.001);
      const costs = await app.harness.snapshot(CostsDoc, context);
      const requestId = Object.keys(costs!.requests)[0];
      await recordRequestUsage(app.harness, requestId, reportedUsage(0.001));
      await recordRequestUsage(app.harness, requestId, reportedUsage(0.001));
      expect((await app.stats()).total).toEqual(settledStats.total);
    } finally {
      stream.end();
      await app.close();
      setupSpy.mockRestore();
      temporaryStorage.cleanup();
    }
  });

  it('migrates the legacy ledger once, settles known usage, and retains unmatched reservations', async () => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir);
    let app = await App.open(config);
    try {
      const day = localDay(config.now(), config.timezone);
      await app.harness.commit(async transaction => {
        const costs = await transaction.doc(CostsDoc);
        delete costs.legacyDailyReservations;
        costs.requests.known = { model: 'faux/faux-1', role: 'main', day, reservedUsd: 0.3, usage: reportedUsage(0.01) };
        costs.requests.unknown = { model: 'faux/faux-1', role: 'main', day, reservedUsd: 0.2, usage: null };
        (await transaction.doc(AppDoc)).dailyReservations[day] = 0.9;
      }, context);
      await app.close();
      app = await App.open(config);
      const stats = await app.stats();
      expect(stats.total.countedUsd).toBeCloseTo(0.61);
      expect(stats.today.countedUsd).toBeCloseTo(0.61);
      expect(stats.total.unknownReservedUsd).toBeCloseTo(0.6);
      expect(stats.total.openReservedUsd).toBe(0);
      await app.close();
      app = await App.open(config);
      expect((await app.stats()).total).toEqual(stats.total);
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('validates the optional lifetime USD cap', () => {
    expect(configFromEnv({}).totalUsdCap).toBeUndefined();
    expect(configFromEnv({ RAHAT_PI_TOTAL_USD_CAP: '0.25' }).totalUsdCap).toBe(0.25);
    for (const value of ['0', '-1', 'NaN']) {
      expect(() => configFromEnv({ RAHAT_PI_TOTAL_USD_CAP: value })).toThrow();
    }
  });
});
