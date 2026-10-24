import { useState } from 'react';
import type { StoppedTask } from '@api';
import { Button } from '../../components/Button';
import { describeError, retryTask } from '../../api/client';
import { stoppedCountLabel, stoppedTaskSentence } from './health';

// Shown on every screen size: a stopped task otherwise fails silently, for example a
// routine that no longer runs or a chat answer that never finishes.
export function StoppedTasksBanner({ stoppedTasks }: { stoppedTasks: StoppedTask[] }) {
  if (stoppedTasks.length === 0) {
    return null;
  }
  return (
    <section role="alert" className="space-y-2 bg-red-600 px-4 py-3 text-sm text-white">
      <p className="font-semibold">{stoppedCountLabel(stoppedTasks.length)}</p>
      {stoppedTasks.map(task => <StoppedTaskRow key={task.taskId} task={task} />)}
    </section>
  );
}

function StoppedTaskRow({ task }: { task: StoppedTask }) {
  const [retrying, setRetrying] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function retry() {
    setRetrying(true);
    setFeedback(null);
    try {
      // The live state drops the row once the brain runs the task again.
      await retryTask({ taskId: task.taskId });
    } catch (error) {
      setFeedback(describeError(error));
      setRetrying(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex-1 wrap-anywhere">{stoppedTaskSentence(task)}</span>
      {task.canRetry && (
        <Button variant="secondary" onClick={retry} disabled={retrying}>{retrying ? 'Retrying…' : 'Retry'}</Button>
      )}
      {feedback && <p className="w-full text-xs text-red-100">{feedback}</p>}
    </div>
  );
}
