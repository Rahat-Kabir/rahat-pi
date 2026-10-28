import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPrivateKey, generateKeyPairSync, sign, type webcrypto } from 'node:crypto';
import type { Harness } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { NotificationsDoc, latestSeq } from './notifications.js';
import { crashAt } from '../config.js';

export const pushKeysFile = 'push-keys.json';
// Push services use this to contact the sender; there is no public operator to name.
const vapidSubject = 'mailto:rahat-pi@localhost';
const vapidLifetimeSeconds = 12 * 60 * 60;
// An approval waits up to 24 hours, so the push service may hold a ping that long.
const pushTimeToLiveSeconds = 24 * 60 * 60;
const pushTimeoutMs = 10_000;
const maximumBackoffMs = 60 * 60 * 1000;

export type PushKeys = { privateKey: webcrypto.JsonWebKey; publicKey: string };
// Sends one push and returns the HTTP status. Tests pass a fake.
export type PushSender = (endpoint: string, headers: Record<string, string>) => Promise<number>;

// The browser's subscription is bound to this key pair, so it survives restarts and is backed up.
export function loadOrCreatePushKeys(dataDir: string): PushKeys {
  const keysPath = join(dataDir, pushKeysFile);
  if (existsSync(keysPath)) {
    return JSON.parse(readFileSync(keysPath, 'utf8')) as PushKeys;
  }
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateJwk = privateKey.export({ format: 'jwk' });
  // The browser wants the raw uncompressed point: 0x04, then x, then y.
  const publicKey = Buffer.concat([
    Buffer.from([4]), Buffer.from(privateJwk.x!, 'base64url'), Buffer.from(privateJwk.y!, 'base64url'),
  ]).toString('base64url');
  const keys = { privateKey: privateJwk, publicKey };
  writeFileSync(keysPath, JSON.stringify(keys) + '\n', { mode: 0o600 });
  chmodSync(keysPath, 0o600);
  return keys;
}

// A VAPID token (RFC 8292) proves the push comes from the server the browser subscribed with.
export function vapidAuthorization(endpoint: string, keys: PushKeys, now: number) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + vapidLifetimeSeconds,
    sub: vapidSubject,
  })}`;
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: createPrivateKey({ key: keys.privateKey, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${unsigned}.${signature.toString('base64url')}, k=${keys.publicKey}`;
}

export const sendWebPush: PushSender = async (endpoint, headers) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(pushTimeoutMs),
  });
  return response.status;
};

// Pushes carry no content: they only wake the app's service worker, which then reads
// the notification text from this server. Push services never see what happened.
export class Notifier {
  constructor(
    private harness: Harness,
    readonly keys: PushKeys,
    private sendPush: PushSender,
    private now: () => number,
    private shouldStop: () => boolean = () => false,
  ) {}
  // At least once: a crash after a push but before saving it pushes again. A repeated
  // ping only repeats a notification; a lost one could let an approval expire unseen.
  async tick() {
    if (this.shouldStop()) {
      return;
    }
    const state = await this.harness.snapshot(NotificationsDoc, context);
    if (!state) {
      return;
    }
    const newestSeq = latestSeq(state);
    for (const [id, subscription] of Object.entries(state.subscriptions)) {
      if (subscription.pushedSeq >= newestSeq || subscription.nextAttemptAt > this.now()) {
        continue;
      }
      let status: number;
      try {
        status = await this.sendPush(subscription.endpoint, {
          Authorization: vapidAuthorization(subscription.endpoint, this.keys, this.now()),
          TTL: String(pushTimeToLiveSeconds),
          Urgency: 'high',
        });
      } catch (error) {
        console.error(`Push failed; retrying later: ${error instanceof Error ? error.message : String(error)}`);
        status = 0;
      }
      crashAt('push_sent');
      await this.harness.commit(async transaction => {
        const notifications = await transaction.doc(NotificationsDoc);
        const currentSubscription = notifications.subscriptions[id];
        if (!currentSubscription) {
          return;
        }
        if (status >= 200 && status < 300) {
          currentSubscription.pushedSeq = Math.max(currentSubscription.pushedSeq, newestSeq);
          currentSubscription.failures = 0;
          currentSubscription.nextAttemptAt = 0;
        } else if (status === 404 || status === 410) {
          // The browser unsubscribed or the subscription expired; it will never accept a push again.
          delete notifications.subscriptions[id];
        } else {
          currentSubscription.failures += 1;
          currentSubscription.nextAttemptAt = this.now() + Math.min(5000 * 2 ** currentSubscription.failures, maximumBackoffMs);
        }
      }, context);
      if (status !== 0 && (status < 200 || status >= 300)) {
        console.error(`Push service answered ${status} for a subscription`);
      }
    }
  }
}
