import { describe, expect, it } from 'vitest';
import type { StoppedTask } from '@api';
import { stoppedCountLabel, stoppedTaskSentence } from './health';

function stoppedTask(reason: StoppedTask['reason']): StoppedTask {
  return { taskId: 7, kind: 'rahat.daily-briefing', label: 'Routine "Daily briefing"', reason, restarts: 5, canRetry: reason === 'restart_limit' };
}

describe('stopped tasks', () => {
  it('says what stopped and why', () => {
    expect(stoppedTaskSentence(stoppedTask('restart_limit'))).toBe('Routine "Daily briefing" stopped after crashing 5 times in a row.');
    expect(stoppedTaskSentence(stoppedTask('missing_task'))).toContain('code is missing');
    expect(stoppedTaskSentence(stoppedTask('task_too_old'))).toContain('newer version');
    expect(stoppedTaskSentence(stoppedTask('migration_failed'))).toContain('could not be upgraded');
  });

  it('counts stopped tasks', () => {
    expect(stoppedCountLabel(1)).toBe('1 task stopped');
    expect(stoppedCountLabel(2)).toBe('2 tasks stopped');
  });
});
