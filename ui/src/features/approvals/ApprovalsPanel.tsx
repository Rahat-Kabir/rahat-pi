import type { Action } from '@api';
import { Panel } from '../../components/Panel';
import { ApprovalCard } from './ApprovalCard';
import { sortForReview } from './approvals';

export function ApprovalsPanel({ actions }: { actions: Action[] }) {
  const waiting = actions.filter(action => action.status === 'proposed').length;
  return (
    <Panel
      title="Approvals"
      actions={waiting > 0 && (
        <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">{waiting} waiting</span>
      )}
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {actions.length === 0
          ? <p className="text-sm text-slate-500 dark:text-slate-400">Nothing to approve. The agent asks here before it sends anything.</p>
          : sortForReview(actions).map(action => <ApprovalCard key={action.id} action={action} />)}
      </div>
    </Panel>
  );
}
