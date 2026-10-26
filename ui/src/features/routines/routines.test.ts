import { describe, expect, it } from 'vitest';
import type { Routine } from '@api';
import { routineCountLabel, routineLastRun, routineNextRun, routineSchedule } from './routines';

const routine: Routine = {
  id: '14',
  name: 'Morning',
  prompt: 'Brief me',
  time: '08:00',
  timezone: 'Etc/GMT-6',
  enabled: true,
  nextRunAt: Date.UTC(2026, 9, 25, 2, 0),
  lastRun: null,
};

describe('routines', () => {
  it('describes the schedule in the routine timezone', () => {
    expect(routineSchedule(routine)).toBe('Daily at 08:00 (Etc/GMT-6)');
  });

  it('shows the next run only while the routine is on', () => {
    // 02:00 UTC is 08:00 in Etc/GMT-6, whatever timezone the browser is in.
    expect(routineNextRun(routine, 'en-GB')).toMatch(/^Next run 25 Oct 2026, 08:00$/);
    expect(routineNextRun({ ...routine, enabled: false }, 'en-GB')).toBe('Paused');
  });

  it('says how the latest run went', () => {
    expect(routineLastRun(routine)).toBe('Has not run yet');
    const lastRun = { occurrenceTime: Date.UTC(2026, 9, 24, 2, 0), status: 'failed' as const };
    expect(routineLastRun({ ...routine, lastRun }, 'en-GB')).toMatch(/^Last run .*2026.*: failed$/);
    expect(routineLastRun({ ...routine, lastRun: { ...lastRun, status: 'succeeded' } }, 'en-GB')).toMatch(/: done$/);
  });

  it('counts routines', () => {
    expect(routineCountLabel(1)).toBe('1 routine');
    expect(routineCountLabel(3)).toBe('3 routines');
  });
});
