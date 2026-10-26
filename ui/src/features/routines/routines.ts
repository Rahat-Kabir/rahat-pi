import type { Routine } from '@api';

const runOutcomes = { running: 'running now', succeeded: 'done', failed: 'failed' } as const;

// Run times use the routine's own timezone, so they match the "Daily at" time beside them.
function formatTime(timestamp: number, timezone: string, locale?: string) {
  return new Date(timestamp).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone });
}

// The schedule as the brain stores it: a time of day in the routine's own timezone.
export function routineSchedule(routine: Routine) {
  return `Daily at ${routine.time} (${routine.timezone})`;
}

// A paused routine's stored next run is stale, so it is not shown.
export function routineNextRun(routine: Routine, locale?: string) {
  return routine.enabled ? `Next run ${formatTime(routine.nextRunAt, routine.timezone, locale)}` : 'Paused';
}

export function routineLastRun(routine: Routine, locale?: string) {
  if (!routine.lastRun) {
    return 'Has not run yet';
  }
  return `Last run ${formatTime(routine.lastRun.occurrenceTime, routine.timezone, locale)}: ${runOutcomes[routine.lastRun.status]}`;
}

export function routineCountLabel(count: number) {
  return count === 1 ? '1 routine' : `${count} routines`;
}
