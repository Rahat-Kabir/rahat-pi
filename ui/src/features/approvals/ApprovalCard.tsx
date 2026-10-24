import { useState } from 'react';
import type { Action } from '@api';
import { Button } from '../../components/Button';
import { decideAction, describeError } from '../../api/client';
import { canApprove, canReject, statusLabels } from './approvals';

const statusColors: Record<Action['status'], string> = {
  proposed: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  approved: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  executing: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  succeeded: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  unknown: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  rejected: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export function ApprovalCard({ action, token }: { action: Action; token: string }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    setFeedback(null);
    try {
      // Send the hash of the payload shown on this card; the brain refuses it if the payload changed.
      await decideAction(token, { decision, id: action.id, payloadHash: action.payloadHash });
    } catch (error) {
      setFeedback(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Send message</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[action.status]}`}>
          {statusLabels[action.status]}
        </span>
      </div>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">To</dt>
          <dd className="break-all font-medium text-slate-900 dark:text-slate-100">{action.payload.recipient}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">Message</dt>
          <dd className="max-h-48 overflow-auto whitespace-pre-wrap wrap-anywhere rounded-lg bg-slate-50 p-2 text-slate-800 dark:bg-slate-950 dark:text-slate-200">
            {action.payload.body}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Expires {new Date(action.expiresAt).toLocaleString()} · hash <code title={action.payloadHash}>{action.payloadHash.slice(0, 12)}…</code>
      </p>
      {action.error && <p className="text-xs text-red-700 dark:text-red-300">{action.error}</p>}
      {action.providerReceipt && <p className="break-all text-xs text-slate-500">Receipt {action.providerReceipt}</p>}
      {canReject(action) && (
        <div className="flex gap-2">
          {canApprove(action) && (
            <Button onClick={() => decide('approve')} disabled={busy || !token} className="flex-1">Approve exactly this</Button>
          )}
          <Button variant="danger" onClick={() => decide('reject')} disabled={busy || !token}>
            {canApprove(action) ? 'Reject' : 'Cancel before sending'}
          </Button>
        </div>
      )}
      {canReject(action) && !token && <p className="text-xs text-slate-500">Paste the web token above to decide.</p>}
      {feedback && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{feedback}</p>}
    </article>
  );
}
