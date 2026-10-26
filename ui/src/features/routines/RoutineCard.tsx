import { useState } from 'react';
import type { Routine, RoutineChangeRequest } from '@api';
import { Button } from '../../components/Button';
import { changeRoutine, describeError } from '../../api/client';
import { routineLastRun, routineNextRun, routineSchedule } from './routines';

export function RoutineCard({ routine }: { routine: Routine }) {
  // Deleting cannot be undone from the app, so the first tap only asks.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function change(routineChange: RoutineChangeRequest['change']) {
    setBusy(true);
    setFeedback(null);
    try {
      // The live state shows the new status once the brain has changed it.
      await changeRoutine({ id: routine.id, change: routineChange });
      setConfirmingDelete(false);
    } catch (error) {
      setFeedback(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-start justify-between gap-2">
        {/* Text only: React escapes it, so a routine name or prompt can never become HTML. */}
        <h3 className="wrap-anywhere text-sm font-semibold text-slate-900 dark:text-slate-100">{routine.name}</h3>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${routine.enabled
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
          : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}
        >
          {routine.enabled ? 'On' : 'Paused'}
        </span>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-300">{routineSchedule(routine)}</p>
      <p className="whitespace-pre-wrap wrap-anywhere rounded-lg bg-slate-50 p-2 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-100">{routine.prompt}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{routineNextRun(routine)} · {routineLastRun(routine)}</p>
      {confirmingDelete ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-600 dark:text-slate-300">Delete this routine?</span>
          <Button variant="danger" onClick={() => change('delete')} disabled={busy}>{busy ? 'Deleting…' : 'Yes, delete'}</Button>
          <Button variant="secondary" onClick={() => setConfirmingDelete(false)} disabled={busy}>Keep</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {routine.enabled
            ? <Button variant="secondary" onClick={() => change('pause')} disabled={busy}>Pause</Button>
            : <Button onClick={() => change('resume')} disabled={busy}>Resume</Button>}
          <Button variant="danger" onClick={() => setConfirmingDelete(true)} disabled={busy}>Delete</Button>
        </div>
      )}
      {feedback && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{feedback}</p>}
    </article>
  );
}
