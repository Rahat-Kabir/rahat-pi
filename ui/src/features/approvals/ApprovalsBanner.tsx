import { waitingLabel } from './approvals';

// Phone only: the approvals panel sits outside the visible chat there, so a pinned
// banner makes a waiting approval hard to miss. Desktop shows the panel beside the chat.
export function ApprovalsBanner({ waiting, onReview }: { waiting: number; onReview: () => void }) {
  if (waiting === 0) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={onReview}
      className="flex w-full items-center justify-between gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-white lg:hidden"
    >
      <span>{waitingLabel(waiting)}</span>
      <span>Review ↓</span>
    </button>
  );
}
