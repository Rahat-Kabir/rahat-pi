import { describe, expect, it, vi } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { configure, LiveDoc } from '@earendil-works/pi-durable';
import type { ConversationId } from '@earendil-works/pi-durable';
import { configFromEnv } from '../src/config.js';
import { App, botProfile } from '../src/harness/app.js';
import { createBotRecord, defaultBotId, defaultBotName, BotsDoc } from '../src/harness/bots.js';
import { buildModels } from '../src/harness/models.js';
import { cli, jsonOutput, offlineConfig, temporaryData, testOwnerName, testTimezone } from './helpers.js';

describe('bot registry', () => {
  it('adopts the root conversation as the default bot once', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      expect(await app.listBots()).toEqual([
        { id: defaultBotId, name: defaultBotName, conversationId: app.root.id, createdAt: expect.any(Number), deleted: false },
      ]);
      // Reopening does not adopt twice or change the record.
      await app.close();
      const reopened = await App.open(offlineConfig(temporaryStorage.dataDir));
      try {
        const stored = (await reopened.harness.snapshot(BotsDoc, context))!.bots;
        expect(Object.values(stored)).toHaveLength(1);
        expect(stored[defaultBotId].conversationId).toBe(reopened.root.id);
      } finally {
        await reopened.close();
      }
    } finally {
      temporaryStorage.cleanup();
    }
  });

  it('reapplies the root agent to every bot on reopen', async () => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir);
    const { modelRef } = buildModels(config);
    const app = await App.open(config);
    try {
      const bot = await app.dispatch({ name: 'createBot', botName: 'Stale' }) as { conversationId: number };
      // A bot created under an older config carries a different agent until reopen reconfigures it.
      await app.harness.commit(
        transaction => configure(transaction, bot.conversationId as ConversationId, { model: modelRef, tools: [] }),
        context,
      );
      await app.close();
      const reopened = await App.open(offlineConfig(temporaryStorage.dataDir));
      try {
        const conversation = await reopened.harness.conversation(bot.conversationId as ConversationId, context);
        const agent = await conversation!.agent(context);
        const rootAgent = await reopened.root.agent(context);
        expect(agent.model?.modelId).toBe(rootAgent.model?.modelId);
        expect(agent.tools.map(tool => tool.name)).toEqual(rootAgent.tools.map(tool => tool.name));
      } finally {
        await reopened.close();
      }
    } finally {
      temporaryStorage.cleanup();
    }
  });

  it('creates a bot with its own ownerless conversation and the same agent as the root', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      const bot = await app.dispatch({ name: 'createBot', botName: 'Coder' }) as { id: string; conversationId: number };
      const bots = await app.listBots();
      expect(bots.map(each => each.id)).toEqual([defaultBotId, bot.id]);
      const record = await app.harness.commit(
        transaction => transaction.conversation(bot.conversationId as ConversationId),
        context,
      );
      // An ownerless conversation has no task owner, unlike a subagent's child.
      expect(record?.owner).toBeUndefined();
      const conversation = await app.harness.conversation(bot.conversationId as ConversationId, context);
      const agent = await conversation!.agent(context);
      const rootAgent = await app.root.agent(context);
      expect(agent.model?.modelId).toBe(rootAgent.model?.modelId);
      expect(agent.tools.map(tool => tool.name)).toEqual(rootAgent.tools.map(tool => tool.name));
      await expect(app.dispatch({ name: 'createBot', botName: '' })).rejects.toThrow('Bot name must be 1 to 40 characters');
      await expect(app.dispatch({ name: 'createBot', botName: 'x'.repeat(41) })).rejects.toThrow('Bot name must be 1 to 40 characters');
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('stores a bot persona and model role on the record', async () => {
    const temporaryStorage = temporaryData();
    const config = offlineConfig(temporaryStorage.dataDir);
    const { modelRef } = buildModels(config);
    const app = await App.open(config);
    try {
      const bot = await app.harness.commit(
        transaction => createBotRecord(
          transaction,
          'Watcher',
          app.config.now(),
          { model: modelRef, tools: [] },
          'Speaks briefly, checks the weather.',
          'helper',
        ),
        context,
      );
      const stored = (await app.harness.snapshot(BotsDoc, context))!.bots[bot.id];
      expect(stored.persona).toBe('Speaks briefly, checks the weather.');
      expect(stored.modelRole).toBe('helper');
      // The default bot record keeps the old shape: no persona, no role.
      const defaultRecord = (await app.harness.snapshot(BotsDoc, context))!.bots[defaultBotId];
      expect(defaultRecord.persona).toBeUndefined();
      expect(defaultRecord.modelRole).toBeUndefined();
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('refuses an unknown model role and an over-long persona', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      await expect(app.dispatch({ name: 'createBot', botName: 'Turbo', model: 'turbo' })).rejects.toThrow('Bot model must be main or helper');
      await expect(app.dispatch({ name: 'createBot', botName: 'Chatty', persona: 'x'.repeat(2001) })).rejects.toThrow('Bot persona must be at most 2000 characters');
      // A blank persona is dropped, not refused: the bot simply speaks with the shared profile.
      const bot = await app.dispatch({ name: 'createBot', botName: 'Quiet', persona: '   ' }) as { persona?: string };
      expect(bot.persona).toBeUndefined();
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('reapplies each bot own role model on reopen', async () => {
    const temporaryStorage = temporaryData();
    // Non-offline: buildModels resolves real catalog models for both roles. Opening the
    // app makes no model call, so no key is needed.
    const config = configFromEnv({
      RAHAT_PI_DATA_DIR: temporaryStorage.dataDir,
      RAHAT_PI_OWNER_NAME: testOwnerName,
      RAHAT_PI_TIMEZONE: testTimezone,
      RAHAT_PI_COMPACT_AT_TOKENS: '8000',
    });
    const { modelRef: mainModelRef } = buildModels(config);
    const app = await App.open(config);
    try {
      const bot = await app.dispatch({ name: 'createBot', botName: 'Watcher', persona: 'Speaks briefly.', model: 'helper' }) as { conversationId: number };
      const conversation = await app.harness.conversation(bot.conversationId as ConversationId, context);
      expect((await conversation!.agent(context)).model?.modelId).toBe('anthropic/claude-haiku-5.5');
      // A bot created under an older config carries a different agent until reopen reconfigures it.
      await app.harness.commit(
        transaction => configure(transaction, bot.conversationId as ConversationId, { model: mainModelRef, tools: [] }),
        context,
      );
      await app.close();
      const reopened = await App.open(config);
      try {
        const reopenedConversation = await reopened.harness.conversation(bot.conversationId as ConversationId, context);
        const agent = await reopenedConversation!.agent(context);
        // Its own role's model, not the root's; the root's tools still apply.
        expect(agent.model?.modelId).toBe('anthropic/claude-haiku-5.5');
        const rootAgent = await reopened.root.agent(context);
        expect(agent.model?.modelId).not.toBe(rootAgent.model?.modelId);
        expect(agent.tools.map(tool => tool.name)).toEqual(rootAgent.tools.map(tool => tool.name));
      } finally {
        await reopened.close();
      }
    } finally {
      temporaryStorage.cleanup();
    }
  });

  it('creates a bot with a persona and model role from the CLI', async () => {
    const temporaryStorage = temporaryData();
    try {
      const bot = jsonOutput(await cli(temporaryStorage.dataDir, ['bot', 'create', 'Watcher', '--persona', 'Speaks briefly.', '--model', 'helper'])) as {
        id: string; persona?: string; modelRole?: string;
      };
      expect(bot.persona).toBe('Speaks briefly.');
      expect(bot.modelRole).toBe('helper');
      const listed = jsonOutput(await cli(temporaryStorage.dataDir, ['bots'])) as { id: string; persona?: string; modelRole?: string }[];
      expect(listed.find(each => each.id === bot.id)).toMatchObject({ persona: 'Speaks briefly.', modelRole: 'helper' });
    } finally {
      temporaryStorage.cleanup();
    }
  });

  it('keeps the default profile and adds each bot persona to the shared rules', () => {
    const config = offlineConfig('unused-data-dir');
    const shared = botProfile(config, undefined);
    expect(shared).toContain('You are Rahat-PI, the personal agent of Test Owner. Timezone: Etc/GMT-6.');
    expect(shared).not.toContain('weather');
    const defaultBot = { id: defaultBotId, name: defaultBotName, conversationId: 1, createdAt: 0, deleted: false };
    expect(botProfile(config, defaultBot)).toBe(shared);
    const watcher = { ...defaultBot, id: 'bot-2', name: 'Watcher', persona: 'A patient weather watcher.' };
    const watcherProfile = botProfile(config, watcher);
    expect(watcherProfile).toContain('You are Watcher, a bot operated by Test Owner');
    expect(watcherProfile).toContain('A patient weather watcher.');
    // Every bot gets the same safety rules, whatever its persona says.
    for (const rule of ['untrusted facts', 'memory_search', 'proposals', 'action_status', '"succeeded" with a receipt', 'fixtures for now']) {
      expect(watcherProfile).toContain(rule);
    }
  });

  it('chats with a persona bot through the profile section', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      const bot = await app.dispatch({ name: 'createBot', botName: 'Watcher', persona: 'A patient weather watcher.' }) as { id: string; conversationId: number };
      await app.submitMessage('any report?', 'followUp', undefined, bot.id);
      await vi.waitFor(async () => {
        const entries = await app.harness.commit(
          transaction => transaction.scanEntries({ conversationId: bot.conversationId as ConversationId }, 10),
          context,
        );
        const text = JSON.stringify(entries.items.flatMap(entry => entry.model ?? []));
        expect(text).toContain('Offline reply: any report?');
      });
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('chats with a bot without touching the default bot conversation', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      const bot = await app.dispatch({ name: 'createBot', botName: 'Coder' }) as { id: string; conversationId: number };
      const { submissionId } = await app.submitMessage('hello from the owner', 'followUp', undefined, bot.id);
      expect(submissionId).toBeGreaterThan(0);
      await vi.waitFor(async () => {
        const entries = await app.harness.commit(
          transaction => transaction.scanEntries({ conversationId: bot.conversationId as ConversationId }, 10),
          context,
        );
        const text = JSON.stringify(entries.items.flatMap(entry => entry.model ?? []));
        expect(text).toContain('Offline reply: hello from the owner');
      });
      const rootEntries = await app.harness.commit(
        transaction => transaction.scanEntries({ conversationId: app.root.id }, 10),
        context,
      );
      expect(rootEntries.items.flatMap(entry => entry.model ?? []).filter(message => message.role === 'user')).toHaveLength(0);
      await expect(app.submitMessage('x', 'followUp', undefined, 'missing')).rejects.toThrow('Bot not found');
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('deletes a bot but refuses the default bot and unknown ids', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      await expect(app.dispatch({ name: 'deleteBot', id: defaultBotId })).rejects.toThrow('The default bot cannot be deleted');
      await expect(app.dispatch({ name: 'deleteBot', id: 'missing' })).rejects.toThrow('Bot not found');
      const bot = await app.dispatch({ name: 'createBot', botName: 'Temp' }) as { id: string };
      expect(await app.dispatch({ name: 'deleteBot', id: bot.id })).toEqual({ id: bot.id, status: 'deleted' });
      expect((await app.listBots()).map(each => each.id)).toEqual([defaultBotId]);
      // The tombstone keeps the id refused and the conversation history stored.
      await expect(app.dispatch({ name: 'deleteBot', id: bot.id })).rejects.toThrow('Bot not found');
      await expect(app.submitMessage('x', 'followUp', undefined, bot.id)).rejects.toThrow('Bot not found');
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('refuses a second live bot with the same name but frees the name after deletion', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      const bot = await app.dispatch({ name: 'createBot', botName: 'Coder' }) as { id: string };
      // Names are trimmed, so " Coder " is the same name, not a loophole.
      await expect(app.dispatch({ name: 'createBot', botName: ' Coder ' })).rejects.toThrow('Bot name already in use');
      await app.dispatch({ name: 'deleteBot', id: bot.id });
      const replacement = await app.dispatch({ name: 'createBot', botName: 'Coder' }) as { id: string };
      expect(replacement.id).not.toBe(bot.id);
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('aborts a busy bot conversation when the run deadline passes', async () => {
    const temporaryStorage = temporaryData();
    // A run deadline of 1 ms passes while the run is still open, so the watchdog aborts it.
    const app = await App.open(offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_MAX_RUN_MS: '1' }));
    try {
      const bot = await app.dispatch({ name: 'createBot', botName: 'Slow' }) as { id: string; conversationId: number };
      await app.submitMessage('this run will be cut short', 'followUp', undefined, bot.id);
      await vi.waitFor(async () => {
        const live = await app.harness.snapshot(LiveDoc, bot.conversationId as ConversationId, context);
        expect(live?.run).toBeUndefined();
      }, { timeout: 5000 });
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });
});
