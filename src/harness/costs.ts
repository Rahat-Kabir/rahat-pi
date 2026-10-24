import { defineDoc, type Harness } from '@earendil-works/pi-durable';
import type { JsonRepresentation } from '@earendil-works/chord';
import type { Usage } from '@earendil-works/pi-ai';
import { AppDoc } from './state.js';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

export type RequestCost = {
  model: string;
  role: 'main' | 'subagent' | 'compaction';
  day: string;
  reservedUsd: number;
  usage: JsonRepresentation<Usage> | null;
  status?: 'open' | 'unknown';
};
export type CostsState = {
  requests: Record<string, RequestCost>;
  legacyDailyReservations?: Record<string, number>;
  legacyActualUsd?: number;
  baselineModels: Record<string, JsonRepresentation<Usage>> | null;
};
export const CostsDoc = defineDoc<CostsState>({
  kind: 'rahat.costs',
  version: 1,
  scope: 'session',
  initial: () => ({ requests: {}, baselineModels: null }),
  checkpointWhen: () => true,
});
export type DispatchAccounting = {
  isChild: boolean;
  recordUsage: (usage: Usage) => Promise<void>;
  finish: () => Promise<void>;
};
export async function recordRequestUsage(harness: Harness, requestId: string, usage: Usage) {
  await harness.commit(async transaction => {
    const request = (await transaction.doc(CostsDoc)).requests[requestId];
    // Store the provider's reported usage before handing the response back to Pi.
    request.usage ??= JSON.parse(JSON.stringify(usage));
  }, context);
}

export async function initializeCosts(harness: Harness) {
  const piUsage = await harness.usage(context);
  await harness.commit(async transaction => {
    const costs = await transaction.doc(CostsDoc);
    if (costs.legacyDailyReservations === undefined) {
      const state = await transaction.doc(AppDoc);
      const journalReservations: Record<string, number> = {};
      for (const request of Object.values(costs.requests)) {
        journalReservations[request.day] = (journalReservations[request.day] ?? 0) + request.reservedUsd;
      }
      costs.legacyDailyReservations = Object.fromEntries(Object.entries(state.dailyReservations).map(
        ([day, reservedUsd]) => [day, Math.max(0, reservedUsd - (journalReservations[day] ?? 0))],
      ));
    }
    if (costs.legacyActualUsd === undefined) {
      const reportedByModel: Record<string, number> = {};
      for (const request of Object.values(costs.requests)) {
        reportedByModel[request.model] = (reportedByModel[request.model] ?? 0) + (request.usage?.cost.total ?? 0);
      }
      costs.legacyActualUsd = Object.entries(piUsage.models).reduce(
        (total, [model, usage]) => total + Math.max(0, usage.cost.total - (reportedByModel[model] ?? 0)), 0,
      );
    }
    for (const request of Object.values(costs.requests)) {
      if (request.usage === null) {
        request.status = 'unknown';
      }
    }
    costs.baselineModels ??= JSON.parse(JSON.stringify(piUsage.models));
  }, context);
}

export async function finishRequest(harness: Harness, requestId: string) {
  await harness.commit(async transaction => {
    const request = (await transaction.doc(CostsDoc)).requests[requestId];
    if (request.usage === null) {
      request.status = 'unknown';
    }
  }, context);
}

// Usage is the settlement record itself: repeated settlement and restart need no refunds.
export function countedSpend(costs: Readonly<CostsState>, day?: string) {
  let countedUsd = Object.entries(costs.legacyDailyReservations ?? {}).reduce(
    (total, [reservationDay, reservedUsd]) => total + (day === undefined || reservationDay === day ? reservedUsd : 0), 0,
  );
  for (const request of Object.values(costs.requests)) {
    if (day === undefined || request.day === day) {
      countedUsd += request.usage?.cost.total ?? request.reservedUsd;
    }
  }
  return countedUsd + (day === undefined ? costs.legacyActualUsd ?? 0 : 0);
}
