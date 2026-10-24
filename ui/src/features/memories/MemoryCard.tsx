import { useState } from 'react';
import type { Memory } from '@api';
import { Button } from '../../components/Button';
import { describeError, forgetMemory } from '../../api/client';
import { memoryOrigin } from './memories';

export function MemoryCard({ memory }: { memory: Memory }) {
  // Forgetting cannot be undone, so the first tap only asks.
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function forget() {
    setBusy(true);
    setFeedback(null);
    try {
      // The live state drops the card once the brain has forgotten it.
      await forgetMemory({ id: memory.id });
    } catch (error) {
      setFeedback(describeError(error));
      setBusy(false);
    }
  }

  return (
    <article className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      {/* Text only: React escapes it, so a remembered fact can never become HTML. */}
      <p className="whitespace-pre-wrap wrap-anywhere text-sm text-slate-900 dark:text-slate-100">{memory.content}</p>
      <p className="break-all text-xs text-slate-500 dark:text-slate-400">{memoryOrigin(memory)}</p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-600 dark:text-slate-300">Forget this for good?</span>
          <Button variant="danger" onClick={forget} disabled={busy}>{busy ? 'Forgetting…' : 'Yes, forget'}</Button>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>Keep</Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>Forget</Button>
      )}
      {feedback && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{feedback}</p>}
    </article>
  );
}
