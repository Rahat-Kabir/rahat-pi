import { describe, expect, it, vi } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxProvider, fauxAssistantMessage, fauxToolCall, type FauxResponseFactory } from '@earendil-works/pi-ai/providers/faux';
import type { ConversationId } from '@earendil-works/pi-durable';
import { App } from '../src/harness/app.js';
import { AppDoc } from '../src/harness/state.js';
import { SubagentsDoc } from '../src/extensions/subagents.js';
import { assertAllowedTool, childToolNames, toolPolicy } from '../src/policy/index.js';
import { configFromEnv, type Config } from '../src/config.js';
import * as modelSetup from '../src/harness/models.js';
import { offlineConfig, temporaryData, toolMessage } from './helpers.js';

async function scriptedApp(route: FauxResponseFactory, overrides: Record<string, string> = {}) {
  const temporaryStorage = temporaryData();
  const config = offlineConfig(temporaryStorage.dataDir, overrides);
  const fauxModelProvider = fauxProvider({
    tokensPerSecond: Infinity,
    models: [{ id: 'faux-1', cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }],
  });
  fauxModelProvider.setResponses(Array.from({ length: 40 }, () => route));
  const models = createModels();
  models.setProvider(fauxModelProvider.provider);
  const modelSpy = vi.spyOn(modelSetup, 'buildModels').mockReturnValue({
    models,
    modelRef: { provider: 'faux', modelId: 'faux-1' },
  });
  try {
    const app = await App.open(config);
    return {
      app,
      config,
      fauxModelProvider,
      cleanup: async () => {
        await app.close();
        modelSpy.mockRestore();
        temporaryStorage.cleanup();
      },
    };
  } catch (error) {
    modelSpy.mockRestore();
    temporaryStorage.cleanup();
    throw error;
  }
}

const delegate = (task: string) => toolMessage('subagent_run', { task });

describe('bounded child conversations', () => {
  it('configures the requested model and validates child limits without provider calls', () => {
    const config = configFromEnv({});
    expect(config.subagentModel).toBe('openai/gpt-5.4-mini');
    expect(config.subagentMaxToolCalls).toBe(8);
    expect(config.subagentMaxMs).toBe(90000);
    const { models } = modelSetup.buildModels(config);
    expect(models.getModel('openrouter', config.subagentModel)?.cost).toEqual({ input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 });
    expect(() => modelSetup.buildModels({ ...config, subagentModel: 'missing' })).toThrow('Unknown');
    expect(() => configFromEnv({ RAHAT_PI_SUBAGENT_MAX_MS: '0' })).toThrow();
    expect(() => configFromEnv({ RAHAT_PI_SUBAGENT_MAX_TOOL_CALLS: '-1' })).toThrow();
    expect(() => configFromEnv({ RAHAT_PI_SUBAGENT_MAX_TOOL_CALLS: '1.5' })).toThrow();
  });

  it('allows only memory search and Calendar reads in child policy', () => {
    for (const toolName of Object.keys(toolPolicy)) {
      if (childToolNames.some(childToolName => childToolName === toolName)) {
        expect(() => assertAllowedTool(toolName, true)).not.toThrow();
      } else {
        expect(() => assertAllowedTool(toolName, true)).toThrow('Child tool denied');
      }
    }
  });

  it('returns a child answer and records child and parent reservations in the same daily ledger', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      await app.dispatch({ name: 'chat', message: toolMessage('memory_write', { content: 'Prefers tea', source: 'owner' }) });
      const response = await app.dispatch({ name: 'chat', message: delegate(toolMessage('memory_search', { query: 'tea' })) });
      expect(JSON.stringify(response)).toContain('Prefers tea');
      const subagentRuns = Object.values((await app.harness.snapshot(SubagentsDoc, context))!.runs);
      expect(subagentRuns).toHaveLength(1);
      const child = (await app.harness.conversation(subagentRuns[0].conversationId as ConversationId, context))!;
      expect((await child.agent(context)).tools.map(tool => tool.name)).toEqual([...childToolNames]);
      const state = (await app.harness.snapshot(AppDoc, context))!;
      expect(Object.values(state.budgets).filter(runBudget => runBudget.conversationId === child.id)).toHaveLength(1);
      expect(Object.keys(state.dailyReservations)).toHaveLength(1);
      expect(Object.values(state.dailyReservations)[0]).toBeGreaterThan(0);
      expect(await app.dispatch({ name: 'subagents' })).toMatchObject([{ status: 'completed', answer: expect.stringContaining('Prefers tea') }]);
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('blocks child writes and grandchildren even if their tools are accidentally re-enabled', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      await app.dispatch({ name: 'chat', message: delegate('first child') });
      const subagentRun = Object.values((await app.harness.snapshot(SubagentsDoc, context))!.runs)[0];
      const child = (await app.harness.conversation(subagentRun.conversationId as ConversationId, context))!;
      await child.configure({ tools: (await app.root.agent(context)).tools }, context);
      const forbiddenCalls = Object.keys(toolPolicy).filter(toolName => !childToolNames.some(childToolName => childToolName === toolName));
      const toolArguments: Record<string, object> = {
        memory_write: { content: 'forbidden', source: 'child' },
        memory_forget: { id: 'fact' },
        routine_create: { name: 'forbidden', prompt: 'bad', time: '08:00', missedRunPolicy: 'skip' },
        routine_list: {},
        routine_pause: { id: 'routine' },
        routine_delete: { id: 'routine' },
        propose_send_message: { recipient: 'outside', body: 'bad' },
        subagent_run: { task: 'grandchild' },
        workspace_list: {},
        workspace_read: { path: 'note.txt' },
        workspace_write: { path: 'note.txt', content: 'forbidden' },
        workspace_shell: { command: 'echo forbidden' },
      };
      for (const toolName of forbiddenCalls) {
        const submission = await child.submit({ type: 'input', content: toolMessage(toolName, toolArguments[toolName]) }, context);
        await submission.wait(context);
      }
      const entries = await app.harness.commit(transaction => transaction.scanEntries({ conversationId: child.id }, 100), context);
      const results = entries.items.flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult');
      expect(results).toHaveLength(forbiddenCalls.length);
      expect(JSON.stringify(results)).toContain('Child tool denied');
      const state = (await app.harness.snapshot(AppDoc, context))!;
      expect(state.memories).toEqual({});
      expect(state.actions).toEqual({});
      expect(state.routines).toEqual({});
      expect(Object.keys((await app.harness.snapshot(SubagentsDoc, context))!.runs)).toHaveLength(1);
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('counts child tool calls across model turns and blocks calls beyond its cap', async () => {
    let childRequests = 0;
    const fixture = await scriptedApp(transcript => {
      const lastMessage = transcript.messages.findLast(message => message.role !== 'system');
      const isChild = transcript.messages.some(message => message.role === 'user' && message.content === 'child task');
      if (isChild) {
        childRequests += 1;
        if (childRequests <= 3) {
          return fauxAssistantMessage(fauxToolCall('memory_search', { query: 'tea' }), { stopReason: 'toolUse' });
        }
        return fauxAssistantMessage('child done');
      }
      if (lastMessage?.role === 'toolResult') {
        return fauxAssistantMessage('parent done');
      }
      return fauxAssistantMessage(fauxToolCall('subagent_run', { task: 'child task' }), { stopReason: 'toolUse' });
    }, { RAHAT_PI_SUBAGENT_MAX_TOOL_CALLS: '2' });
    try {
      await fixture.app.dispatch({ name: 'chat', message: 'delegate' });
      const state = (await fixture.app.harness.snapshot(AppDoc, context))!;
      const childBudget = Object.values(state.budgets).find(runBudget => runBudget.conversationId !== fixture.app.root.id)!;
      expect(childBudget.toolCalls).toHaveLength(2);
      const entries = await fixture.app.harness.commit(transaction => transaction.scanEntries({ conversationId: childBudget.conversationId as ConversationId }, 100), context);
      expect(JSON.stringify(entries.items)).toContain('Run tool call cap reached');
    } finally {
      await fixture.cleanup();
    }
  });

  it('admits two concurrent children, rejects the third, and releases slots after completion', async () => {
    let activeChildren = 0;
    let peakChildren = 0;
    const fixture = await scriptedApp(async transcript => {
      const lastMessage = transcript.messages.findLast(message => message.role !== 'system');
      if (lastMessage?.role === 'user' && typeof lastMessage.content === 'string' && lastMessage.content.startsWith('child ')) {
        activeChildren += 1;
        peakChildren = Math.max(peakChildren, activeChildren);
        await new Promise(resolve => setTimeout(resolve, 150));
        activeChildren -= 1;
        return fauxAssistantMessage('child done');
      }
      if (lastMessage?.role === 'toolResult') {
        return fauxAssistantMessage('parent done');
      }
      return fauxAssistantMessage([1, 2, 3].map(childNumber => fauxToolCall('subagent_run', { task: `child ${childNumber}` })), { stopReason: 'toolUse' });
    });
    try {
      await fixture.app.dispatch({ name: 'chat', message: 'delegate three' });
      expect(peakChildren).toBe(2);
      expect(Object.keys((await fixture.app.harness.snapshot(SubagentsDoc, context))!.runs)).toHaveLength(2);
      const entries = await fixture.app.harness.commit(transaction => transaction.scanEntries({ conversationId: fixture.app.root.id }, 100), context);
      expect(JSON.stringify(entries.items)).toContain('Subagent concurrency limit reached (2)');
      await fixture.app.dispatch({ name: 'chat', message: 'delegate again' });
      expect(Object.keys((await fixture.app.harness.snapshot(SubagentsDoc, context))!.runs)).toHaveLength(4);
    } finally {
      await fixture.cleanup();
    }
  });

  it('refuses a child model request when the shared daily cap is exhausted', async () => {
    let config: Config;
    const fixture = await scriptedApp(() => {
      config.dailyUsdCap = 0.000000001;
      return fauxAssistantMessage(fauxToolCall('subagent_run', { task: 'child task' }), { stopReason: 'toolUse' });
    });
    config = fixture.config;
    try {
      await expect(fixture.app.dispatch({ name: 'chat', message: 'delegate' })).rejects.toThrow();
      expect(fixture.fauxModelProvider.state.callCount).toBe(1);
      const state = (await fixture.app.harness.snapshot(AppDoc, context))!;
      const childBudget = Object.values(state.budgets).find(runBudget => runBudget.conversationId !== fixture.app.root.id);
      expect(childBudget?.tokensReserved ?? 0).toBe(0);
      expect(Object.values(state.dailyReservations)[0]).toBeGreaterThan(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it('aborts an in-flight child at its wall deadline and frees its slot', async () => {
    const fixture = await scriptedApp(async (transcript, options) => {
      const lastMessage = transcript.messages.findLast(message => message.role !== 'system');
      if (lastMessage?.role === 'user' && lastMessage.content === 'slow child') {
        await new Promise<void>(resolve => {
          if (options?.signal?.aborted) {
            resolve();
          } else {
            options?.signal?.addEventListener('abort', () => resolve(), { once: true });
          }
        });
        return fauxAssistantMessage('aborted');
      }
      if (lastMessage?.role === 'toolResult') {
        return fauxAssistantMessage('parent done');
      }
      return fauxAssistantMessage(fauxToolCall('subagent_run', { task: 'slow child' }), { stopReason: 'toolUse' });
    // The deadline must outlast child setup; with synchronous=FULL each commit waits for the disk.
    }, { RAHAT_PI_SUBAGENT_MAX_MS: '1000' });
    try {
      await fixture.app.dispatch({ name: 'chat', message: 'delegate' });
      expect(await fixture.app.dispatch({ name: 'subagents' })).toMatchObject([{ status: 'aborted' }]);
      await fixture.app.dispatch({ name: 'chat', message: 'delegate again' });
      expect(await fixture.app.dispatch({ name: 'subagents' })).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });
  it('cancels an in-flight child when the owner stops the app', async () => {
    let markChildStarted: () => void = () => {};
    const childStarted = new Promise<void>(resolve => {
      markChildStarted = resolve;
    });
    const fixture = await scriptedApp(async (transcript, options) => {
      const lastMessage = transcript.messages.findLast(message => message.role !== 'system');
      if (lastMessage?.role === 'user' && lastMessage.content === 'child waiting for stop') {
        markChildStarted();
        await new Promise<void>(resolve => {
          if (options?.signal?.aborted) {
            resolve();
          } else {
            options?.signal?.addEventListener('abort', () => resolve(), { once: true });
          }
        });
        return fauxAssistantMessage('cancelled');
      }
      return fauxAssistantMessage(fauxToolCall('subagent_run', { task: 'child waiting for stop' }), { stopReason: 'toolUse' });
    });
    try {
      const pendingChat = fixture.app.dispatch({ name: 'chat', message: 'delegate' }).catch(error => error);
      await childStarted;
      await fixture.app.stop();
      expect(await pendingChat).toBeInstanceOf(Error);
    } finally {
      await fixture.cleanup();
    }
  });

});
