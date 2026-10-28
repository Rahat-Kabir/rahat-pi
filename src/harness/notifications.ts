import { createHash } from 'node:crypto';
import { defineDoc, type Tx } from '@earendil-works/pi-durable';
import { fixedUtcOffsetMs } from '../timezone.js';

// A fixed template written by the brain. The model never writes notification text
// or picks who receives it, so a notification is not an external write that needs approval.
export type NotificationRecord = {
  // Derived from the event (for example `approval:<actionId>`), so recording it twice keeps one.
  id: string;
  // Increases by one per record; each browser keeps its place with it.
  seq: number;
  title: string;
  body: string;
  createdAt: number;
};
export type PushSubscriptionRecord = {
  endpoint: string;
  createdAt: number;
  // The newest record this browser was pushed for, and the newest it showed.
  pushedSeq: number;
  shownSeq: number;
  failures: number;
  nextAttemptAt: number;
};
export type NotificationsState = {
  records: Record<string, NotificationRecord>;
  subscriptions: Record<string, PushSubscriptionRecord>;
  nextSeq: number;
  // Stopped tasks already notified. Pi resets a task's restart count on retry, so a task
  // leaves this list once it runs again, and a second stop notifies again.
  notifiedStoppedTaskIds: Record<string, true>;
};
export const NotificationsDoc = defineDoc<NotificationsState>({
  kind: 'rahat.notifications',
  version: 1,
  scope: 'session',
  initial: () => ({ records: {}, subscriptions: {}, nextSeq: 1, notifiedStoppedTaskIds: {} }),
  checkpointWhen: () => true,
});

const keptRecordCount = 100;
const approvalExpiryWarningMs = 2 * 60 * 60 * 1000;
const maximumNameLength = 60;

export const latestSeq = (state: NotificationsState) => state.nextSeq - 1;
export const subscriptionId = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex');

// Call inside the commit that records the event, so the notification exists exactly when the event does.
export async function addNotification(
  transaction: Tx,
  notification: Pick<NotificationRecord, 'id' | 'title' | 'body'>,
  now: number,
) {
  const state = await transaction.doc(NotificationsDoc);
  if (state.records[notification.id]) {
    return;
  }
  state.records[notification.id] = { ...notification, seq: state.nextSeq, createdAt: now };
  state.nextSeq += 1;
  const records = Object.values(state.records).sort((first, second) => first.seq - second.seq);
  for (const oldRecord of records.slice(0, Math.max(0, records.length - keptRecordCount))) {
    delete state.records[oldRecord.id];
  }
}

function localTime(timestamp: number, timezone: string) {
  return new Date(timestamp + fixedUtcOffsetMs(timezone)).toISOString().slice(11, 16);
}
function shortName(name: string) {
  const singleLine = name.replace(/\s+/g, ' ').trim();
  return singleLine.length > maximumNameLength ? `${singleLine.slice(0, maximumNameLength - 1)}…` : singleLine;
}

// Minimal on purpose: no recipient or message body, only what to open the app for.
export const notificationTexts = {
  approvalWaiting: (actionId: string, expiresAt: number, timezone: string) => ({
    id: `approval:${actionId}`,
    title: 'Approval waiting',
    body: `A message draft waits for your approval (expires ${localTime(expiresAt, timezone)}). Open Rahat-PI to review it.`,
  }),
  approvalExpiring: (actionId: string, expiresAt: number, timezone: string) => ({
    id: `expiring:${actionId}`,
    title: 'Approval expires soon',
    body: `A message draft expires at ${localTime(expiresAt, timezone)}. Open Rahat-PI to approve or reject it.`,
  }),
  sendFailed: (actionId: string, reason: string) => ({
    id: `send-result:${actionId}`,
    title: 'Send failed',
    body: `An approved message was not sent: ${reason}.`,
  }),
  sendUnknown: (actionId: string) => ({
    id: `send-result:${actionId}`,
    title: 'Send result unknown',
    body: 'Rahat-PI cannot tell whether an approved message was sent. Check before sending it again.',
  }),
  routineFinished: (runId: string, routineName: string, succeeded: boolean) => ({
    id: `routine:${runId}`,
    title: succeeded ? 'Routine finished' : 'Routine failed',
    body: `"${shortName(routineName)}" ${succeeded ? 'finished' : 'failed'}. Open Rahat-PI to read it.`,
  }),
  taskStopped: (taskId: number, seq: number, label: string) => ({
    id: `stopped:${taskId}:${seq}`,
    title: 'Task stopped',
    body: `${shortName(label)} stopped after repeated crashes. Open Rahat-PI to retry it.`,
  }),
  test: (now: number) => ({
    id: `test:${now}`,
    title: 'Test notification',
    body: 'Notifications from Rahat-PI work.',
  }),
};

export function approvalExpiresSoon(expiresAt: number, now: number) {
  return now < expiresAt && expiresAt - now <= approvalExpiryWarningMs;
}
