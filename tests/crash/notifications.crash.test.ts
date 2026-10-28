import { describe, expect, it } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { App } from '../../src/harness/app.js';
import { NotificationsDoc } from '../../src/harness/notifications.js';
import type { PushSender } from '../../src/harness/push.js';
import { WebResearch } from '../../src/extensions/web-research.js';
import { cli, offlineConfig, temporaryData, toolMessage } from '../helpers.js';

const endpoint = 'https://push.example/subscription-1';

async function withApp<Result>(dataDir: string, work: (app: App, pushes: string[]) => Promise<Result>) {
  const pushes: string[] = [];
  const sendPush: PushSender = async pushEndpoint => {
    pushes.push(pushEndpoint);
    return 201;
  };
  const app = await App.open(offlineConfig(dataDir), new WebResearch(), sendPush);
  try {
    return await work(app, pushes);
  } finally {
    await app.close();
  }
}
async function recordTitles(app: App) {
  const records = Object.values((await app.harness.snapshot(NotificationsDoc, context))?.records ?? {});
  return records.sort((first, second) => first.seq - second.seq).map(record => record.title);
}

describe('notification SIGKILL recovery', () => {
  it('pushes a waiting approval once after a crash right after the proposal', async () => {
    const temporaryStorage = temporaryData();
    try {
      await withApp(temporaryStorage.dataDir, app => app.subscribePush(endpoint));
      const crashed = await cli(temporaryStorage.dataDir, [
        'chat', '--message', toolMessage('propose_send_message', { recipient: 'fixture:alice', body: 'Hi' }),
      ], { RAHAT_PI_CRASH_AT: 'action_proposed' });
      expect(crashed.signal).toBe('SIGKILL');
      await withApp(temporaryStorage.dataDir, async (app, pushes) => {
        await app.dispatch({ name: 'tick' });
        await app.dispatch({ name: 'tick' });
        // The replay-safe tool ran again after the crash; the notification is still one record.
        expect(await recordTitles(app)).toEqual(['Approval waiting']);
        expect(pushes).toEqual([endpoint]);
      });
    } finally {
      temporaryStorage.cleanup();
    }
  });

  it.each([
    ['action_executing', ['Approval waiting', 'Send result unknown']],
    // The send happened and left a receipt, so reconcile proves it: no false alarm.
    ['after_dispatch', ['Approval waiting']],
  ])('after a crash at %s, notifies about a send only when its result stays unknown', async (crashPoint, expectedTitles) => {
    const temporaryStorage = temporaryData();
    try {
      await withApp(temporaryStorage.dataDir, async app => {
        await app.subscribePush(endpoint);
        await app.dispatch({ name: 'chat', message: toolMessage('propose_send_message', { recipient: 'fixture:alice', body: 'Hi' }) });
        const [action] = await app.dispatch({ name: 'actions' }) as { id: string }[];
        await app.dispatch({ name: 'approve', id: action.id });
      });
      const crashed = await cli(temporaryStorage.dataDir, ['tick'], { RAHAT_PI_CRASH_AT: crashPoint });
      expect(crashed.signal).toBe('SIGKILL');
      await withApp(temporaryStorage.dataDir, async app => {
        await app.dispatch({ name: 'tick' });
        await app.dispatch({ name: 'tick' });
        expect(await recordTitles(app)).toEqual(expectedTitles);
      });
    } finally {
      temporaryStorage.cleanup();
    }
  });

  it('pushes again after a crash between a push attempt and saving it', async () => {
    const temporaryStorage = temporaryData();
    // Nothing listens on port 1, so the real push attempt fails fast without leaving this machine.
    const unreachableEndpoint = 'https://127.0.0.1:1/push';
    try {
      await withApp(temporaryStorage.dataDir, async app => {
        await app.subscribePush(unreachableEndpoint);
        await app.dispatch({ name: 'testNotification' });
      });
      const crashed = await cli(temporaryStorage.dataDir, ['tick'], { RAHAT_PI_CRASH_AT: 'push_sent' });
      expect(crashed.signal).toBe('SIGKILL');
      await withApp(temporaryStorage.dataDir, async (app, pushes) => {
        const [subscription] = Object.values((await app.harness.snapshot(NotificationsDoc, context))!.subscriptions);
        expect(subscription).toMatchObject({ pushedSeq: 0, failures: 0 });
        await app.dispatch({ name: 'tick' });
        expect(pushes).toEqual([unreachableEndpoint]);
      });
    } finally {
      temporaryStorage.cleanup();
    }
  });
});
