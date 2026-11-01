import type { AppNotification, PendingNotificationsResponse } from '@api';

// What the service worker does when a push arrives. Pushes carry no content, so it asks
// the brain for the text, shows each record, then tells the brain how far it got.
// Kept free of service-worker globals so tests can pass fakes.

export type NotificationOptionsShown = { body: string; tag: string; data: { url: string } };
export type ServiceWorkerTools = {
  endpoint: () => Promise<string | null>;
  fetch: typeof fetch;
  showNotification: (title: string, options: NotificationOptionsShown) => Promise<void>;
};

export const appUrl = '/app/';
// Shown when the brain cannot be asked, so a ping is never lost silently
// (for example, an approval waiting while the browser is signed out).
export const fallbackNotification = { title: 'Rahat-PI', body: 'Something new is waiting. Open Rahat-PI to see it.' };

async function postJson(tools: ServiceWorkerTools, path: string, body: unknown) {
  const response = await tools.fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status})`);
  }
  return response.json() as Promise<unknown>;
}

function show(tools: ServiceWorkerTools, notification: Pick<AppNotification, 'title' | 'body'>, tag: string) {
  return tools.showNotification(notification.title, { body: notification.body, tag, data: { url: appUrl } });
}

export async function showPendingNotifications(tools: ServiceWorkerTools) {
  const endpoint = await tools.endpoint();
  if (!endpoint) {
    await show(tools, fallbackNotification, 'rahat-fallback');
    return;
  }
  let notifications: AppNotification[];
  try {
    ({ notifications } = await postJson(tools, '/api/notifications/pending', { endpoint }) as PendingNotificationsResponse);
  } catch {
    await show(tools, fallbackNotification, 'rahat-fallback');
    return;
  }
  // A repeated ping finds nothing new; the records were already shown.
  if (notifications.length === 0) {
    return;
  }
  // The record id as tag: if a crash shows one twice, the second replaces the first.
  for (const notification of notifications) {
    await show(tools, notification, notification.id);
  }
  await postJson(tools, '/api/notifications/shown', { endpoint, seq: notifications.at(-1)!.seq });
}
