import { appUrl, showPendingNotifications } from './features/notifications/serviceWorker';

// The service worker, built to /app/sw.js. The app's tsconfig has DOM types, not worker
// types, so this file names only the few worker parts it uses.
type ExtendableEvent = Event & { waitUntil: (work: Promise<unknown>) => void };
type WindowClient = { url: string; focus: () => Promise<unknown> };
type WorkerScope = {
  addEventListener: (type: 'push' | 'notificationclick', listener: (event: ExtendableEvent) => void) => void;
  registration: ServiceWorkerRegistration;
  clients: {
    matchAll: (options: { type: 'window' }) => Promise<WindowClient[]>;
    openWindow: (url: string) => Promise<unknown>;
  };
};
const worker = self as unknown as WorkerScope;

worker.addEventListener('push', event => {
  event.waitUntil(showPendingNotifications({
    endpoint: async () => (await worker.registration.pushManager.getSubscription())?.endpoint ?? null,
    fetch: (input, init) => fetch(input, init),
    showNotification: (title, options) => worker.registration.showNotification(title, options),
  }));
});

// Tapping a notification brings the open app forward, or opens it.
worker.addEventListener('notificationclick', event => {
  (event as ExtendableEvent & { notification: Notification }).notification.close();
  event.waitUntil(worker.clients.matchAll({ type: 'window' }).then(windows => {
    const openApp = windows.find(window => new URL(window.url).pathname.startsWith(appUrl));
    return openApp ? openApp.focus() : worker.clients.openWindow(appUrl);
  }));
});
