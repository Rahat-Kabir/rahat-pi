import { defineDoc, type Harness } from '@earendil-works/pi-durable';
import type { JsonRepresentation } from '@earendil-works/chord';
import type { Usage } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

export type RequestCost = {
  model: string;
  role: 'main' | 'subagent' | 'compaction';
  day: string;
  reservedUsd: number;
  usage: JsonRepresentation<Usage> | null;
};
type CostsState = {
  requests: Record<string, RequestCost>;
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
};
export async function recordRequestUsage(harness: Harness, requestId: string, usage: Usage) {
  await harness.commit(async transaction => {
    const request = (await transaction.doc(CostsDoc)).requests[requestId];
    // Store the provider's reported usage before handing the response back to Pi.
    request.usage ??= JSON.parse(JSON.stringify(usage));
  }, context);
}

export async function initializeCosts(harness: Harness) {
  const costs = await harness.snapshot(CostsDoc, context);
  if (costs?.baselineModels !== null && costs?.baselineModels !== undefined) {
    return;
  }
  const piUsage = await harness.usage(context);
  await harness.commit(async transaction => {
    const costs = await transaction.doc(CostsDoc);
    costs.baselineModels ??= JSON.parse(JSON.stringify(piUsage.models));
  }, context);
}
