import { randomUUID } from 'node:crypto';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { configure, defineDoc, type ConversationId, type Harness, type ModelRef, type ToolRegistration, type Tx } from '@earendil-works/pi-durable';

// A bot is a record plus its own conversation, never a process: creating one writes
// config only, the way the rest of the app shares one harness and one model pool.
export type Bot = {
  id: string;
  name: string;
  conversationId: number;
  createdAt: number;
  deleted: boolean;
};
export type BotsState = { bots: Record<string, Bot> };
export const BotsDoc = defineDoc<BotsState>({
  kind: 'rahat.bots',
  version: 1,
  scope: 'session',
  initial: () => ({ bots: {} }),
  checkpointWhen: () => true,
});

// The default bot is the chat that existed before bots; it is adopted once and never deleted.
export const defaultBotId = 'main';
export const defaultBotName = 'Rahat-PI';

export async function ensureDefaultBot(transaction: Tx, rootConversationId: ConversationId, now: number) {
  const state = await transaction.doc(BotsDoc);
  state.bots[defaultBotId] ??= {
    id: defaultBotId,
    name: defaultBotName,
    conversationId: rootConversationId,
    createdAt: now,
    deleted: false,
  };
}

// One commit creates the conversation, configures the same agent the root has, and
// records the bot, so a bot never exists half-made after a crash.
export async function createBotRecord(
  transaction: Tx,
  name: string,
  now: number,
  agent: { model: ModelRef; tools: ToolRegistration[] },
): Promise<Bot> {
  // Names target routines ("schedule it for Coder"), so live bots need distinct names;
  // a deleted bot's name is free again.
  const bots = (await transaction.doc(BotsDoc)).bots;
  if (Object.values(bots).some(bot => !bot.deleted && bot.name === name)) {
    throw new Error('Bot name already in use');
  }
  const conversation = await transaction.createConversation({ ownership: { kind: 'ownerless' } });
  await configure(transaction, conversation.id, agent);
  const bot: Bot = { id: randomUUID(), name, conversationId: conversation.id, createdAt: now, deleted: false };
  (await transaction.doc(BotsDoc)).bots[bot.id] = bot;
  return bot;
}

// Config is authoritative on reopen for bots, the way it is for the root: every bot
// created earlier is reconfigured with the current agent, so a model or tool change
// reaches them, too. The default bot's conversation is the root, configured by the caller.
export async function reconfigureBots(
  harness: Harness,
  agent: { model: ModelRef; tools: ToolRegistration[] },
  rootConversationId: ConversationId,
) {
  const state = await harness.snapshot(BotsDoc, context);
  for (const bot of Object.values(state?.bots ?? {})) {
    // A deleted bot never runs again; its conversation keeps whatever it last had.
    if (bot.deleted || bot.conversationId === rootConversationId) {
      continue;
    }
    const conversation = await harness.conversation(bot.conversationId as ConversationId, context);
    await conversation?.configure(agent, context);
  }
}

// The default bot comes first, then the others by creation time; deleted bots drop out.
export function sortBots(bots: Bot[]) {
  return [...bots].sort((first, second) => {
    if (first.id === defaultBotId || second.id === defaultBotId) {
      return first.id === defaultBotId ? -1 : 1;
    }
    return first.createdAt - second.createdAt;
  });
}

// A routine's conversation, resolved from the registry inside the same commit that
// (re)creates its task. An absent botId is the default bot; a deleted bot throws.
export async function botConversationId(transaction: Tx, botId: string | undefined): Promise<ConversationId> {
  const bot = (await transaction.doc(BotsDoc)).bots[botId ?? defaultBotId];
  if (!bot || bot.deleted) {
    throw new Error('Bot not found');
  }
  return bot.conversationId as ConversationId;
}

// The bot a new routine belongs to: the named one (a Chief may schedule for others),
// else the bot whose chat is creating it. The task reports into that bot's conversation.
export async function resolveRoutineBot(
  transaction: Tx,
  currentConversationId: ConversationId,
  requestedBotName: string | undefined,
): Promise<{ botId: string; conversationId: ConversationId }> {
  const liveBots = sortBots(Object.values((await transaction.doc(BotsDoc)).bots).filter(bot => !bot.deleted));
  const bot = requestedBotName !== undefined
    ? liveBots.find(candidate => candidate.name === requestedBotName)
    : liveBots.find(candidate => candidate.conversationId === currentConversationId) ?? liveBots[0];
  if (!bot) {
    throw new Error(requestedBotName === undefined ? 'No live bot found' : `No bot named "${requestedBotName}"`);
  }
  return { botId: bot.id, conversationId: bot.conversationId as ConversationId };
}
