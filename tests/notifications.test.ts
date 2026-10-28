import { describe, expect, it } from 'vitest';
import { createPublicKey, verify } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { App } from '../src/harness/app.js';
import { NotificationsDoc } from '../src/harness/notifications.js';
import { loadOrCreatePushKeys, vapidAuthorization, type PushSender } from '../src/harness/push.js';
import { WebResearch } from '../src/extensions/web-research.js';
import { offlineConfig, temporaryData, toolMessage } from './helpers.js';

const endpoint = 'https://push.example/subscription-1';
type PushCall = { endpoint: string; headers: Record<string, string> };

function fakePushService(statuses: number[] = []) {
  const calls: PushCall[] = [];
  const send: PushSender = async (pushEndpoint, headers) => {
    calls.push({ endpoint: pushEndpoint, headers });
    return statuses.shift() ?? 201;
  };
  return { calls, send };
}
// Each step opens the app at a fixed time, as the routine tests do.
function appAt(dataDir: string, time: string, sendPush: PushSender) {
  return App.open(offlineConfig(dataDir, { RAHAT_PI_NOW: time }), new WebResearch(), sendPush);
}
async function withApp<Result>(dataDir: string, time: string, sendPush: PushSender, work: (app: App) => Promise<Result>) {
  const app = await appAt(dataDir, time, sendPush);
  try {
    return await work(app);
  } finally {
    await app.close();
  }
}
const titles = (notifications: { title: string }[]) => notifications.map(notification => notification.title);

describe('notifications', () => {
  it('keeps one push key pair and signs a VAPID token the push service can verify', () => {
    const temporaryStorage = temporaryData();
    try {
      const keys = loadOrCreatePushKeys(temporaryStorage.dataDir);
      expect(loadOrCreatePushKeys(temporaryStorage.dataDir)).toEqual(keys);
      expect(statSync(join(temporaryStorage.dataDir, 'push-keys.json')).mode & 0o777).toBe(0o600);
      expect(Buffer.from(keys.publicKey, 'base64url')).toHaveLength(65);

      const now = Date.parse('2026-10-28T10:00:00Z');
      const authorization = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, now);
      const [, token, publicKey] = /^vapid t=([^,]+), k=(.+)$/.exec(authorization)!;
      expect(publicKey).toBe(keys.publicKey);
      const [header, payload, signature] = token.split('.');
      expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      expect(claims.aud).toBe('https://fcm.googleapis.com');
      expect(claims.exp - now / 1000).toBeLessThanOrEqual(24 * 60 * 60);
      expect(claims.sub).toMatch(/^mailto:/);
      const { d: _privatePart, ...publicJwk } = keys.privateKey;
      expect(verify('sha256', Buffer.from(`${header}.${payload}`), {
        key: createPublicKey({ key: publicJwk, format: 'jwk' }),
        dsaEncoding: 'ieee-p1363',
      }, Buffer.from(signature, 'base64url'))).toBe(true);
    } finally {
      temporaryStorage.cleanup();
    }
  });

  it('notifies about a waiting approval without its content, pushes once, and tracks what was shown', async () => {
    const temporaryStorage = temporaryData();
    const pushService = fakePushService();
    try {
      await withApp(temporaryStorage.dataDir, '2026-10-28T10:00:00+06:00', pushService.send, async app => {
        // Nothing is pushed before a browser subscribes, and a new browser does not replay old records.
        await app.dispatch({ name: 'testNotification' });
        await app.dispatch({ name: 'tick' });
        expect(pushService.calls).toEqual([]);
        await app.subscribePush(endpoint);
        expect(await app.pendingNotifications(endpoint)).toEqual([]);

        await app.dispatch({ name: 'chat', message: toolMessage('propose_send_message', { recipient: 'fixture:alice', body: 'Secret plan' }) });
        await app.dispatch({ name: 'tick' });
        await app.dispatch({ name: 'tick' });
        expect(pushService.calls).toHaveLength(1);
        expect(pushService.calls[0]).toMatchObject({ endpoint, headers: { TTL: '86400', Urgency: 'high' } });
        expect(pushService.calls[0].headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);

        const pending = await app.pendingNotifications(endpoint);
        expect(pending).toMatchObject([{
          title: 'Approval waiting',
          body: 'A message draft waits for your approval (expires 10:00). Open Rahat-PI to review it.',
        }]);
        expect(JSON.stringify(pending)).not.toMatch(/alice|Secret plan/);
        expect(await app.markNotificationsShown(endpoint, pending[0].seq)).toEqual({ shownSeq: pending[0].seq });
        expect(await app.pendingNotifications(endpoint)).toEqual([]);
        await expect(app.markNotificationsShown(endpoint, pending[0].seq + 1)).rejects.toThrow('Unknown notification');
        await expect(app.pendingNotifications('https://push.example/other')).rejects.toThrow('Push subscription not found');

        // The same event recorded again (here: the test at the same fixed time as the first one) stays one record.
        await app.dispatch({ name: 'testNotification' });
        const records = Object.values((await app.harness.snapshot(NotificationsDoc, context))!.records);
        expect(titles(records.sort((first, second) => first.seq - second.seq))).toEqual(['Test notification', 'Approval waiting']);
      });
    } finally {
      temporaryStorage.cleanup();
    }
  });

  it('warns before an approval expires and reports a send that failed', async () => {
    const temporaryStorage = temporaryData();
    const pushService = fakePushService();
    try {
      const actionId = await withApp(temporaryStorage.dataDir, '2026-10-28T10:00:00+06:00', pushService.send, async app => {
        await app.subscribePush(endpoint);
        await app.dispatch({ name: 'chat', message: toolMessage('propose_send_message', { recipient: 'fixture:alice', body: 'Hi' }) });
        const [action] = await app.dispatch({ name: 'actions' }) as { id: string }[];
        await app.dispatch({ name: 'approve', id: action.id });
        await app.dispatch({ name: 'reject', id: action.id });
        await app.dispatch({ name: 'chat', message: toolMessage('propose_send_message', { recipient: 'fixture:bob', body: 'Hi' }) });
        const actions = await app.dispatch({ name: 'actions' }) as { id: string }[];
        return actions[1].id;
      });
      await withApp(temporaryStorage.dataDir, '2026-10-29T07:00:00+06:00', pushService.send, async app => {
        // Three hours left: not yet.
        await app.dispatch({ name: 'tick' });
        expect(titles(await app.pendingNotifications(endpoint))).toEqual(['Approval waiting', 'Approval waiting']);
      });
      await withApp(temporaryStorage.dataDir, '2026-10-29T08:30:00+06:00', pushService.send, async app => {
        await app.dispatch({ name: 'tick' });
        await app.dispatch({ name: 'tick' });
        const pending = await app.pendingNotifications(endpoint);
        // Only the open proposal warns; the rejected one does not.
        expect(pending.slice(2)).toMatchObject([{
          id: `expiring:${actionId}`,
          title: 'Approval expires soon',
          body: 'A message draft expires at 10:00. Open Rahat-PI to approve or reject it.',
        }]);
        await app.dispatch({ name: 'approve', id: actionId });
      });
      // Approved but not sent before the deadline: the executor fails it and says so.
      await withApp(temporaryStorage.dataDir, '2026-10-29T10:00:00+06:00', pushService.send, async app => {
        await app.dispatch({ name: 'tick' });
        expect((await app.pendingNotifications(endpoint)).at(-1)).toMatchObject({
          id: `send-result:${actionId}`,
          title: 'Send failed',
          body: 'An approved message was not sent: approval expired or the draft changed.',
        });
      });
    } finally {
      temporaryStorage.cleanup();
    }
  });

  it('tells the owner when a routine finished', async () => {
    const temporaryStorage = temporaryData();
    const pushService = fakePushService();
    try {
      await withApp(temporaryStorage.dataDir, '2026-10-28T07:00:00+06:00', pushService.send, async app => {
        await app.subscribePush(endpoint);
        await app.dispatch({ name: 'chat', message: toolMessage('routine_create', {
          name: 'Morning', prompt: 'Brief me', time: '08:00', missedRunPolicy: 'catchUpOnce',
        }) });
      });
      await withApp(temporaryStorage.dataDir, '2026-10-28T08:00:00+06:00', pushService.send, async app => {
        await app.dispatch({ name: 'tick' });
        expect(await app.pendingNotifications(endpoint)).toMatchObject([{
          title: 'Routine finished',
          body: '"Morning" finished. Open Rahat-PI to read it.',
        }]);
        expect(pushService.calls).toHaveLength(1);
      });
    } finally {
      temporaryStorage.cleanup();
    }
  });

  it('backs off after a push service error and drops a subscription the browser gave up', async () => {
    const temporaryStorage = temporaryData();
    const pushService = fakePushService([500, 201, 410]);
    try {
      await withApp(temporaryStorage.dataDir, '2026-10-28T10:00:00+06:00', pushService.send, async app => {
        await app.subscribePush(endpoint);
        await app.dispatch({ name: 'testNotification' });
        await app.dispatch({ name: 'tick' });
        await app.dispatch({ name: 'tick' });
        expect(pushService.calls).toHaveLength(1);
        const subscriptions = (await app.harness.snapshot(NotificationsDoc, context))!.subscriptions;
        expect(Object.values(subscriptions)).toMatchObject([{ failures: 1, nextAttemptAt: Date.parse('2026-10-28T10:00:10+06:00') }]);
      });
      // Ten seconds later the backoff has passed and the retry succeeds.
      await withApp(temporaryStorage.dataDir, '2026-10-28T10:00:10+06:00', pushService.send, async app => {
        await app.dispatch({ name: 'tick' });
        expect(pushService.calls).toHaveLength(2);
        await app.dispatch({ name: 'testNotification' });
        await app.dispatch({ name: 'tick' });
        expect(pushService.calls).toHaveLength(3);
        expect((await app.harness.snapshot(NotificationsDoc, context))!.subscriptions).toEqual({});
      });
    } finally {
      temporaryStorage.cleanup();
    }
  });
});
