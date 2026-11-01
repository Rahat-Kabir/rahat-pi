import { describe, expect, it } from 'vitest';
import type { AppNotification } from '@api';
import { fallbackNotification, showPendingNotifications, type NotificationOptionsShown } from './serviceWorker';
import { decodePushKey, notificationButtonLabel } from './notifications';

const endpoint = 'https://push.example/subscription-1';

function notification(seq: number, title: string): AppNotification {
  return { id: `notification-${seq}`, seq, title, body: `Body ${seq}`, createdAt: 0 };
}

// A fake brain answering the two notification endpoints, plus a record of what the worker showed.
function fakeWorker(options: { endpoint?: string | null; pending?: AppNotification[]; pendingStatus?: number; offline?: boolean }) {
  const requests: { path: string; body: unknown }[] = [];
  const shown: { title: string; options: NotificationOptionsShown }[] = [];
  const tools = {
    endpoint: async () => options.endpoint === undefined ? endpoint : options.endpoint,
    fetch: (async (path: string, init?: RequestInit) => {
      if (options.offline) {
        throw new TypeError('Failed to fetch');
      }
      requests.push({ path, body: JSON.parse(String(init?.body)) });
      const status = path === '/api/notifications/pending' ? options.pendingStatus ?? 200 : 200;
      const body = path === '/api/notifications/pending' ? { notifications: options.pending ?? [] } : { shownSeq: 0 };
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch,
    showNotification: async (title: string, shownOptions: NotificationOptionsShown) => {
      shown.push({ title, options: shownOptions });
    },
  };
  return { tools, requests, shown };
}

describe('service worker push', () => {
  it('shows each pending record in order, then acknowledges the newest', async () => {
    const { tools, requests, shown } = fakeWorker({ pending: [notification(3, 'Approval waiting'), notification(4, 'Routine finished')] });
    await showPendingNotifications(tools);
    expect(shown).toEqual([
      { title: 'Approval waiting', options: { body: 'Body 3', tag: 'notification-3', data: { url: '/app/' } } },
      { title: 'Routine finished', options: { body: 'Body 4', tag: 'notification-4', data: { url: '/app/' } } },
    ]);
    expect(requests).toEqual([
      { path: '/api/notifications/pending', body: { endpoint } },
      { path: '/api/notifications/shown', body: { endpoint, seq: 4 } },
    ]);
  });

  it('shows nothing and acknowledges nothing for a repeated ping', async () => {
    const { tools, requests, shown } = fakeWorker({ pending: [] });
    await showPendingNotifications(tools);
    expect(shown).toEqual([]);
    expect(requests.map(request => request.path)).toEqual(['/api/notifications/pending']);
  });

  it('still alerts the owner when the brain cannot be asked', async () => {
    for (const options of [{ pendingStatus: 401 }, { pendingStatus: 409 }, { offline: true }, { endpoint: null }]) {
      const { tools, requests, shown } = fakeWorker(options);
      await showPendingNotifications(tools);
      expect(shown).toEqual([{ title: fallbackNotification.title, options: { body: fallbackNotification.body, tag: 'rahat-fallback', data: { url: '/app/' } } }]);
      expect(requests.some(request => request.path === '/api/notifications/shown')).toBe(false);
    }
  });
});

describe('notification settings', () => {
  it('decodes the brain key from base64url to raw bytes', () => {
    // 0x04 0xfb 0xff: "+" and "/" in plain base64 become "-" and "_", without padding.
    expect([...decodePushKey('BPv_')]).toEqual([0x04, 0xfb, 0xff]);
    expect(decodePushKey('B'.repeat(87)).length).toBe(65);
  });

  it('labels each state', () => {
    expect(notificationButtonLabel('off')).toBe('Turn on notifications');
    expect(notificationButtonLabel('on')).toBe('Notifications on');
    expect(notificationButtonLabel('blocked')).toContain('blocked');
    expect(notificationButtonLabel('unsupported')).toContain('not available');
  });
});
