import { describe, expect, it } from 'vitest';
import type { Action, ActionStatus } from '@api';
import { canApprove, canReject, sortForReview, waitingCount, waitingLabel } from './approvals';

function action(id: string, status: ActionStatus, expiresAt: number): Action {
  return {
    id, kind: 'send_message', payload: { recipient: 'a@example.com', body: 'Hi' }, payloadHash: `hash-${id}`,
    status, expiresAt, approvedAt: null, providerReceipt: null, error: null,
  };
}

describe('approvals', () => {
  it('offers approval once, and rejection until sending starts', () => {
    expect(canApprove(action('1', 'proposed', 0))).toBe(true);
    expect(canReject(action('1', 'proposed', 0))).toBe(true);
    expect(canApprove(action('2', 'approved', 0))).toBe(false);
    expect(canReject(action('2', 'approved', 0))).toBe(true);
    for (const status of ['executing', 'succeeded', 'failed', 'unknown', 'rejected'] as const) {
      expect(canApprove(action('3', status, 0))).toBe(false);
      expect(canReject(action('3', status, 0))).toBe(false);
    }
  });

  it('puts actions waiting for the owner first, then newest first', () => {
    const sorted = sortForReview([
      action('old-sent', 'succeeded', 100),
      action('old-waiting', 'proposed', 200),
      action('new-sent', 'succeeded', 400),
      action('new-waiting', 'proposed', 300),
    ]);
    expect(sorted.map(item => item.id)).toEqual(['new-waiting', 'old-waiting', 'new-sent', 'old-sent']);
  });

  it('counts only actions still waiting for the owner', () => {
    expect(waitingCount([action('a', 'proposed', 1), action('b', 'approved', 2), action('c', 'proposed', 3), action('d', 'unknown', 4)])).toBe(2);
    expect(waitingCount([])).toBe(0);
    expect(waitingLabel(1)).toBe('1 approval waiting');
    expect(waitingLabel(3)).toBe('3 approvals waiting');
  });
});
