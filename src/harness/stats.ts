import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { Harness, Cursor } from '@earendil-works/pi-durable';
import { AppDoc } from './state.js';
import { CostsDoc, type RequestCost } from './costs.js';
import { localDay } from '../timezone.js';

type Spend = { actualUsd: number; reservedUsd: number; requests: number; unknownRequests: number };
function emptySpend(): Spend {
  return { actualUsd: 0, reservedUsd: 0, requests: 0, unknownRequests: 0 };
}
function addRequest(spend: Spend, request: RequestCost) {
  spend.reservedUsd += request.reservedUsd;
  spend.requests += 1;
  if (request.usage === null) {
    spend.unknownRequests += 1;
  } else {
    spend.actualUsd += request.usage.cost.total;
  }
}

export async function readStats(harness: Harness, now: number, timezone: string) {
  const day = localDay(now, timezone);
  const state = await harness.snapshot(AppDoc, context);
  const costs = await harness.snapshot(CostsDoc, context);
  const piUsage = await harness.usage(context);
  const today = emptySpend();
  const total = emptySpend();
  const models: Record<string, { model: string; role: RequestCost['role']; today: Spend; total: Spend }> = {};
  const observedByModel: Record<string, number> = {};
  for (const request of Object.values(costs?.requests ?? {})) {
    const modelKey = `${request.role}:${request.model}`;
    const breakdown = models[modelKey] ??= { model: request.model, role: request.role, today: emptySpend(), total: emptySpend() };
    addRequest(total, request);
    addRequest(breakdown.total, request);
    observedByModel[request.model] = (observedByModel[request.model] ?? 0) + (request.usage?.cost.total ?? 0);
    if (request.day === day) {
      addRequest(today, request);
      addRequest(breakdown.today, request);
    }
  }
  // Old stores have Pi totals but no dated request journal. Never invent attribution.
  const unattributedByModel = Object.fromEntries(Object.entries(piUsage.models).map(([model, usage]) => [
    model, Math.max(costs?.baselineModels?.[model]?.cost.total ?? 0, usage.cost.total - (observedByModel[model] ?? 0)),
  ]));
  const unattributedActualUsd = Object.values(unattributedByModel).reduce((sum, actualUsd) => sum + actualUsd, 0);
  total.actualUsd += unattributedActualUsd;
  total.reservedUsd = Object.values(state?.dailyReservations ?? {}).reduce((sum, reservedUsd) => sum + reservedUsd, 0);
  today.reservedUsd = state?.dailyReservations[day] ?? 0;
  const tasks = { total: 0, crashed: 0, parked: 0, aborted: 0, faulted: 0 };
  const inspection = await harness.inspect(context);
  tasks.parked = inspection.tasks.filter(task => task.state.kind === 'blocked' && task.state.reason === 'restart_limit').length;
  const toolFailures: Record<string, number> = Object.create(null);
  let cursor: Cursor | undefined;
  do {
    const page = await harness.commit(transaction => transaction.scanTasks({}, 200, cursor), context);
    for (const task of page.items) {
      tasks.total += 1;
      if ((task.restarts ?? 0) > 0) {
        tasks.crashed += 1;
      }
      if (task.state.outcome?.status === 'aborted') {
        tasks.aborted += 1;
      }
      if (task.state.outcome?.status === 'faulted') {
        tasks.faulted += 1;
      }
    }
    cursor = page.next;
  } while (cursor !== undefined);
  cursor = undefined;
  do {
    const page = await harness.commit(transaction => transaction.scanConversations({}, 200, cursor), context);
    for (const conversation of page.items) {
      let entryCursor: Cursor | undefined;
      do {
        const entries = await harness.commit(
          transaction => transaction.scanEntries({ conversationId: conversation.id }, 200, entryCursor),
          context,
        );
        for (const entry of entries.items) {
          for (const message of entry.model ?? []) {
            if (message.role === 'toolResult' && message.isError) {
              toolFailures[message.toolName] = (toolFailures[message.toolName] ?? 0) + 1;
            }
          }
        }
        entryCursor = entries.next;
      } while (entryCursor !== undefined);
    }
    cursor = page.next;
  } while (cursor !== undefined);
  const actions = { proposed: 0, approved: 0, executing: 0, succeeded: 0, failed: 0, unknown: 0, rejected: 0 };
  for (const action of Object.values(state?.actions ?? {})) {
    actions[action.status] += 1;
  }
  return {
    day,
    timezone,
    enforcement: 'Conservative reservations; no refunds. Actuals are reported usage, not invoice receipts.',
    today,
    total,
    models: Object.values(models).sort((first, second) => `${first.role}:${first.model}`.localeCompare(`${second.role}:${second.model}`)),
    unattributedActualUsd,
    unattributedByModel,
    piUsage,
    tasks,
    toolFailures,
    actions,
  };
}
export type Stats = Awaited<ReturnType<typeof readStats>> & { subagents: Record<string, number> };
export function formatStats(stats: Stats) {
  const money = (amount: number) => `$${amount.toFixed(6)}`;
  const lines = [
    `Spend (USD; ${stats.day}, ${stats.timezone})`,
    `Today: actual ${money(stats.today.actualUsd)} / reserved ${money(stats.today.reservedUsd)}`,
    `Total: actual ${money(stats.total.actualUsd)} / reserved ${money(stats.total.reservedUsd)}`,
    `Unknown request costs: ${stats.total.unknownRequests}; unattributed actual: ${money(stats.unattributedActualUsd)}`,
    'Role / model: today actual / reserved; total actual / reserved',
    ...stats.models.map(model => {
      const todaySpend = `${money(model.today.actualUsd)} / ${money(model.today.reservedUsd)}`;
      const totalSpend = `${money(model.total.actualUsd)} / ${money(model.total.reservedUsd)}`;
      return `${model.role} / ${model.model}: ${todaySpend}; ${totalSpend}`;
    }),
    `Durable tasks: ${JSON.stringify(stats.tasks)}`,
    `Tool failures: ${JSON.stringify(stats.toolFailures)}`,
    `Actions: ${JSON.stringify(stats.actions)}`,
    `Subagents: ${JSON.stringify(stats.subagents)}`,
    stats.enforcement,
  ];
  return lines.join('\n');
}
