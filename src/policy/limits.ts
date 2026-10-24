import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ToolTask, LiveDoc, ProviderDoc, hook, type Harness, type ConversationId } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { Model, Context as ModelContext } from '@earendil-works/pi-ai';
import type { Config } from '../config.js';
import { CostsDoc, recordRequestUsage, finishRequest, countedSpend } from '../harness/costs.js';
import { localDay } from '../timezone.js';
import { AppDoc, type RunBudget } from '../harness/state.js';
import { SubagentsDoc, childDeadlineReached } from '../extensions/subagents.js';
import { assertAllowedTool } from './index.js';

// Checks both clocks: config.now() may be a fixed test or demo time, Date.now() is real wall time.
export function runDeadlineReached(config: Config, runBudget: Readonly<RunBudget>) {
  return config.now() - runBudget.startedAt >= config.maxRunMs
    || Date.now() - runBudget.realStartedAt >= config.maxRunMs;
}

// Generation hooks are observational: Pi reports their errors and continues.
// This guard is awaited by the Models wrapper BEFORE invoking the provider.
export async function reserveModelRequest(
  config: Config,
  harness: Harness,
  model: Model<string>,
  transcript: ModelContext,
  sessionId: string | undefined,
  isCompaction = false,
) {
  if (existsSync(join(config.dataDir, 'stop'))) {
    throw new Error('Agent stopped');
  }
  const root = await harness.root(context);
  const subagents = await harness.snapshot(SubagentsDoc, context);
  const candidates = [root.id, ...Object.values(subagents?.runs ?? {}).map(subagentRun => subagentRun.conversationId as ConversationId)];
  let conversationId: ConversationId | undefined;
  for (const candidateId of candidates) {
    const provider = await harness.snapshot(ProviderDoc, candidateId, context);
    if (provider?.sessionId === sessionId && sessionId !== undefined) {
      conversationId = candidateId;
      break;
    }
  }
  if (conversationId === undefined) {
    throw new Error('Unknown provider session for safety accounting');
  }
  const subagentRun = Object.values(subagents?.runs ?? {}).find(subagentRun => subagentRun.conversationId === conversationId);
  if (subagentRun && childDeadlineReached(config, subagentRun)) {
    throw new Error('Subagent wall time cap reached');
  }
  const liveConversation = await harness.snapshot(LiveDoc, conversationId, context);
  let submissionId: string | number | undefined = liveConversation?.run?.inputs[0];
  if (isCompaction) {
    if (liveConversation?.compactions?.length !== 1) {
      throw new Error('Compaction accounting requires exactly one active summary task; retry after current work settles');
    }
    const compaction = liveConversation?.compactions?.[0];
    if (compaction?.reason === 'manual') {
      submissionId = `compaction:${compaction.taskId}`;
    } else if (compaction === undefined) {
      throw new Error('No active compaction for safety accounting');
    }
  }
  if (submissionId === undefined) {
    throw new Error('No active run for safety accounting');
  }
  const conversation = await harness.conversation(conversationId, context);
  const agent = await conversation!.agent(context);
  // One UTF-8 byte per input token, including schemas, plus framing overhead.
  const inputTokenBound = Buffer.byteLength(JSON.stringify({ messages: transcript.messages, tools: agent.tools })) + 4096;
  const tokenReservation = inputTokenBound + config.maxOutputTokens;
  const highestInputPrice = Math.max(model.cost.input, model.cost.cacheRead, model.cost.cacheWrite);
  const usdReservation = (inputTokenBound * highestInputPrice + config.maxOutputTokens * model.cost.output) / 1000000;
  if (!Number.isFinite(usdReservation) || usdReservation < 0) {
    throw new Error('Unknown model pricing; refusing request');
  }
  const requestId = randomUUID();
  await harness.commit(async transaction => {
    const state = await transaction.doc(AppDoc);
    if (!state.budgets[submissionId]) {
      state.budgets[submissionId] = {
        startedAt: config.now(),
        realStartedAt: Date.now(),
        tokensReserved: 0,
        toolCalls: [],
        conversationId,
      };
    }
    const runBudget = state.budgets[submissionId];
    if (runDeadlineReached(config, runBudget)) {
      throw new Error('Run wall time cap reached');
    }
    if (runBudget.tokensReserved + tokenReservation > config.maxRunTokens) {
      throw new Error('Run token cap reached');
    }
    const reservationDay = localDay(config.now(), config.timezone);
    const dailyReservedUsd = state.dailyReservations[reservationDay] ?? 0;
    const costs = await transaction.doc(CostsDoc);
    if (countedSpend(costs, reservationDay) + usdReservation > config.dailyUsdCap) {
      throw new Error('Daily USD cap reached');
    }
    if (config.totalUsdCap !== undefined
      && countedSpend(costs) + usdReservation > config.totalUsdCap) {
      throw new Error('Total USD cap reached');
    }
    costs.requests[requestId] = {
      model: `${model.provider}/${model.id}`,
      role: isCompaction ? 'compaction' : subagentRun ? 'subagent' : 'main',
      day: reservationDay,
      reservedUsd: usdReservation,
      usage: null,
      status: 'open',
    };
    // Retain the gross ledger for compatibility; enforcement uses settled request costs.
    runBudget.tokensReserved += tokenReservation;
    state.dailyReservations[reservationDay] = dailyReservedUsd + usdReservation;
  }, context);
  return {
    isChild: subagentRun !== undefined,
    finish: () => finishRequest(harness, requestId),
    recordUsage: (usage: import('@earendil-works/pi-ai').Usage) => recordRequestUsage(harness, requestId, usage),
  };
}
export function limitHooks(config: Config, getHarness: () => Harness) {
  return [hook(ToolTask, { beforeTool: async (toolCall, hookRuntime, hookContext) => {
    const conversation = await getHarness().commit(transaction => transaction.conversation(hookRuntime.conversationId), hookContext);
    const isChild = conversation?.owner !== undefined;
    assertAllowedTool(toolCall.name, isChild);
    const subagents = await hookRuntime.snapshot(SubagentsDoc, hookContext);
    const subagentRun = Object.values(subagents?.runs ?? {}).find(subagentRun => subagentRun.conversationId === hookRuntime.conversationId);
    if (isChild && (!subagentRun || childDeadlineReached(config, subagentRun))) {
      return { block: 'Subagent wall time cap reached or child is unregistered' };
    }
    const maxToolCalls = isChild ? config.subagentMaxToolCalls : config.maxToolCalls;
    const liveConversation = await hookRuntime.snapshot(LiveDoc, hookRuntime.conversationId, hookContext);
    const submissionId = liveConversation?.run?.inputs[0];
    if (submissionId === undefined) {
      return { block: 'No active run for tool accounting' };
    }
    await getHarness().commit(async transaction => {
      const runBudget = (await transaction.doc(AppDoc)).budgets[submissionId];
      if (!runBudget) {
        throw new Error('Run budget missing');
      }
      if (runDeadlineReached(config, runBudget)) {
        throw new Error('Run wall time cap reached');
      }
      if (!runBudget.toolCalls.includes(toolCall.id)) {
        if (runBudget.toolCalls.length >= maxToolCalls) {
          throw new Error('Run tool call cap reached');
        }
        runBudget.toolCalls.push(toolCall.id);
      }
    }, hookContext);
    return undefined;
  } })];
}
