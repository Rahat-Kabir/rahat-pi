import { defineDoc } from '@earendil-works/pi-durable';

export type Memory = {
  id: string;
  content: string;
  source: string;
  createdAt: number;
  trust: 'data';
};
export type SendPayload = {
  recipient: string;
  body: string;
};
export type Action = {
  id: string;
  kind: 'send_message';
  payload: SendPayload;
  payloadHash: string;
  status: 'proposed' | 'approved' | 'executing' | 'succeeded' | 'failed' | 'unknown' | 'rejected';
  expiresAt: number;
  approvedHash: string | null;
  approvedAt: number | null;
  approvedBy: string | null;
  providerReceipt: string | null;
  error: string | null;
};
export type Routine = {
  id: string;
  name: string;
  prompt: string;
  time: string;
  timezone: string;
  nextRunAt: number;
  enabled: boolean;
  deleted: boolean;
  missedRunPolicy: 'skip' | 'catchUpOnce';
  taskId: number;
};
export type RoutineRun = {
  id: string;
  routineId: string;
  occurrenceTime: number;
  status: 'running' | 'succeeded' | 'failed';
  submissionId: number | null;
};
export type RunBudget = {
  startedAt: number;
  realStartedAt: number;
  tokensReserved: number;
  toolCalls: string[];
  conversationId: number;
};
export type AppState = {
  memories: Record<string, Memory>;
  actions: Record<string, Action>;
  routines: Record<string, Routine>;
  routineRuns: Record<string, RoutineRun>;
  budgets: Record<string, RunBudget>;
  dailyReservations: Record<string, number>;
};
export const AppDoc = defineDoc<AppState>({
  kind: 'rahat.app',
  version: 1,
  scope: 'session',
  initial: () => ({ memories: {}, actions: {}, routines: {}, routineRuns: {}, budgets: {}, dailyReservations: {} }),
  checkpointWhen: () => true,
});
