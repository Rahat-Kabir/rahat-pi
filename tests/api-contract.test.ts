import { describe, expectTypeOf, it } from 'vitest';
import type { App } from '../src/harness/app.js';
import type { WebState as BrainWebState } from '../src/web/state.js';
import type {
  MessageResponse, NotificationsShownResponse, PendingNotificationsResponse, PushSubscriptionResponse, WebState,
} from '../src/web/api-types.js';

// These checks run in `npx tsc --noEmit`: the app's contract must stay a view of what the brain sends.
describe('app API contract', () => {
  it('matches the state the brain serves', () => {
    expectTypeOf<BrainWebState>().toExtend<WebState>();
  });

  it('matches the message admission result', () => {
    expectTypeOf<Awaited<ReturnType<App['submitMessage']>>>().toExtend<MessageResponse>();
  });

  it('matches the push and notification results', () => {
    expectTypeOf<Awaited<ReturnType<App['subscribePush']>>>().toExtend<PushSubscriptionResponse>();
    expectTypeOf<Awaited<ReturnType<App['unsubscribePush']>>>().toExtend<PushSubscriptionResponse>();
    expectTypeOf<{ notifications: Awaited<ReturnType<App['pendingNotifications']>> }>().toExtend<PendingNotificationsResponse>();
    expectTypeOf<Awaited<ReturnType<App['markNotificationsShown']>>>().toExtend<NotificationsShownResponse>();
  });
});
