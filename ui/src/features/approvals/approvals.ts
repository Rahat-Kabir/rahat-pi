import type { Action, ActionStatus } from '@api';

// The brain still checks expiry and the hash; these only decide which buttons to show.
export function canApprove(action: Action) {
  return action.status === 'proposed';
}
// An approved action can still be cancelled until the executor starts sending it.
export function canReject(action: Action) {
  return action.status === 'proposed' || action.status === 'approved';
}

// Waiting-for-you first, then newest first. Proposals expire 24h after creation,
// so a later expiry means a newer action.
export function sortForReview(actions: Action[]) {
  return [...actions].sort((first, second) =>
    Number(second.status === 'proposed') - Number(first.status === 'proposed')
    || second.expiresAt - first.expiresAt);
}

export const statusLabels: Record<ActionStatus, string> = {
  proposed: 'Waiting for you',
  approved: 'Approved, sending soon',
  executing: 'Sending',
  succeeded: 'Sent',
  failed: 'Failed',
  // A crash during sending: it may or may not have gone out, and it is never resent.
  unknown: 'Unknown: may or may not have been sent',
  rejected: 'Rejected',
};
