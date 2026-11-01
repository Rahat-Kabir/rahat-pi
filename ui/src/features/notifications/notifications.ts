import type { PushKeyResponse } from '@api';
import { getPushKey, subscribePush, unsubscribePush } from '../../api/client';

// Turning notifications on in this browser: register the service worker, subscribe with
// the brain's key, and tell the brain where to ping. Turning off undoes both.

export type NotificationStatus = 'unsupported' | 'blocked' | 'off' | 'on';
const serviceWorkerUrl = '/app/sw.js';
const serviceWorkerScope = '/app/';

// Push needs a secure page: https, or this computer's own address (127.0.0.1, localhost).
export function notificationsSupported() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// The brain sends its key as base64url; browsers want the raw bytes.
export function decodePushKey(publicKey: PushKeyResponse['publicKey']) {
  const base64 = publicKey.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration(serviceWorkerScope);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function readNotificationStatus(): Promise<NotificationStatus> {
  if (!notificationsSupported()) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') {
    return 'blocked';
  }
  return Notification.permission === 'granted' && await currentSubscription() ? 'on' : 'off';
}

export async function turnOnNotifications(): Promise<NotificationStatus> {
  if (await Notification.requestPermission() !== 'granted') {
    return Notification.permission === 'denied' ? 'blocked' : 'off';
  }
  const registration = await navigator.serviceWorker.register(serviceWorkerUrl, { scope: serviceWorkerScope });
  await navigator.serviceWorker.ready;
  const { publicKey } = await getPushKey();
  const subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodePushKey(publicKey) });
  await subscribePush({ endpoint: subscription.endpoint });
  return 'on';
}

export async function turnOffNotifications(): Promise<NotificationStatus> {
  const subscription = await currentSubscription();
  if (subscription) {
    // Tell the brain first: if this fails, the browser stays subscribed and the owner can retry.
    await unsubscribePush({ endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  }
  return 'off';
}

export function notificationButtonLabel(status: NotificationStatus) {
  switch (status) {
    case 'unsupported':
      return 'Notifications not available here';
    case 'blocked':
      return 'Notifications blocked in browser settings';
    case 'off':
      return 'Turn on notifications';
    case 'on':
      return 'Notifications on';
  }
}
