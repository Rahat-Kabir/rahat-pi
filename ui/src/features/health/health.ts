import type { StoppedTask } from '@api';

// One sentence per stopped task: what stopped and why, in the owner's words.
export function stoppedTaskSentence(task: StoppedTask) {
  switch (task.reason) {
    case 'restart_limit':
      return `${task.label} stopped after crashing ${task.restarts} times in a row.`;
    case 'missing_task':
      return `${task.label} cannot run: its code is missing from this version.`;
    case 'task_too_old':
      return `${task.label} cannot run: it was saved by a newer version.`;
    case 'migration_failed':
      return `${task.label} cannot run: it could not be upgraded to this version.`;
  }
}

export function stoppedCountLabel(count: number) {
  return count === 1 ? '1 task stopped' : `${count} tasks stopped`;
}
