import { defineTask, type Tx, type ConversationId } from '@earendil-works/pi-durable';
import { AppDoc, type Routine } from '../harness/state.js';
import { crashAt } from '../config.js';
import { fixedUtcOffsetMs } from '../timezone.js';

const dayMilliseconds = 86400000;
// utcOffsetMs comes from a fixed-offset timezone (no DST), so every local day is 24 hours.
export function nextDailyOccurrence(time: string, now: number, utcOffsetMs: number): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('Daily time must be HH:mm');
  }
  const [hours, minutes] = time.split(':').map(Number);
  const localDay = Math.floor((now + utcOffsetMs) / dayMilliseconds);
  const candidateOccurrenceTime = localDay * dayMilliseconds + hours * 3600000 + minutes * 60000 - utcOffsetMs;
  return candidateOccurrenceTime > now ? candidateOccurrenceTime : candidateOccurrenceTime + dayMilliseconds;
}
export function occurrenceId(routineId: string, occurrenceTime: number) {
  return `${routineId}:${occurrenceTime}`;
}
export function dueOccurrence(routine: Routine, now: number): number | null {
  if (now < routine.nextRunAt) {
    return null;
  }
  const latestOccurrenceTime = routine.nextRunAt + Math.floor((now - routine.nextRunAt) / dayMilliseconds) * dayMilliseconds;
  // A minute of normal scheduling lateness isn't a missed run.
  return routine.missedRunPolicy === 'skip' && now - latestOccurrenceTime >= 60000 ? null : latestOccurrenceTime;
}
type RoutineCheckpoint = { phase: 'wait' } | { phase: 'deliver'; runId: string; prompt: string };
export const BriefingTask = defineTask<{ routineId: string }, RoutineCheckpoint, null>({
  name: 'rahat.daily-briefing', version: 1, initial: () => ({ phase: 'wait' }),
  phases: {
    wait: async (task, runtime, context) => {
      const routine = (await runtime.snapshot(AppDoc, context))?.routines[task.input.routineId];
      if (!routine || !routine.enabled || routine.deleted) {
        await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: null } }), context);
        return;
      }
      if (routine.nextRunAt > runtime.now()) {
        await runtime.sleepUntil(routine.nextRunAt, { phase: 'wait' }, context);
        return;
      }
      await runtime.commit(async transaction => {
        const state = await transaction.doc(AppDoc);
        const currentRoutine = state.routines[task.input.routineId];
        const occurrenceTime = dueOccurrence(currentRoutine, runtime.now());
        currentRoutine.nextRunAt = nextDailyOccurrence(
          currentRoutine.time,
          runtime.now(),
          fixedUtcOffsetMs(currentRoutine.timezone),
        );
        if (occurrenceTime === null) {
          return { status: 'sleeping', until: currentRoutine.nextRunAt, checkpoint: { phase: 'wait' } };
        }
        const runId = occurrenceId(currentRoutine.id, occurrenceTime);
        if (state.routineRuns[runId]) {
          return { status: 'sleeping', until: currentRoutine.nextRunAt, checkpoint: { phase: 'wait' } };
        }
        state.routineRuns[runId] = { id: runId, routineId: currentRoutine.id, occurrenceTime, status: 'running', submissionId: null };
        return { status: 'running', checkpoint: { phase: 'deliver', runId, prompt: currentRoutine.prompt } };
      }, context);
      // A restart must resume this claim instead of admitting another occurrence.
      crashAt('routine_claimed');
    },
    deliver: async (task, runtime, context) => {
      if (task.state.checkpoint.phase !== 'deliver') {
        throw new Error('Invalid routine checkpoint');
      }
      const { runId, prompt } = task.state.checkpoint;
      const conversation = await runtime.conversation(runtime.conversationId, context);
      if (!conversation) {
        throw new Error('Routine conversation missing');
      }
      const submission = await conversation.submit({
        type: 'input',
        content: `Daily briefing (${runId}). ${prompt}`,
        requestId: runId,
      }, context);
      crashAt('routine_submitted');
      const settledSubmission = await submission.wait(context);
      await runtime.commit(async transaction => {
        const routineRun = (await transaction.doc(AppDoc)).routineRuns[runId];
        routineRun.submissionId = submission.id;
        routineRun.status = settledSubmission.status === 'done' ? 'succeeded' : 'failed';
        return { status: 'running', checkpoint: { phase: 'wait' } };
      }, context);
    },
  },
  abort: (task, runtime, context) => runtime.commit(async transaction => {
    if (task.state.checkpoint.phase === 'deliver') {
      const routineRun = (await transaction.doc(AppDoc)).routineRuns[task.state.checkpoint.runId];
      if (routineRun?.status === 'running') {
        routineRun.status = 'failed';
      }
    }
    return { status: 'terminal', outcome: { status: 'aborted' } };
  }, context),
});
export async function createRoutine(
  transaction: Tx,
  conversationId: ConversationId,
  routineId: string,
  options: { name: string; prompt: string; time: string; missedRunPolicy: 'skip' | 'catchUpOnce' },
  now: number,
  timezone: string,
) {
  const state = await transaction.doc(AppDoc);
  if (state.routines[routineId]) {
    return state.routines[routineId];
  }
  const nextRunAt = nextDailyOccurrence(options.time, now, fixedUtcOffsetMs(timezone));
  const taskId = await transaction.createTask(
    BriefingTask,
    { routineId },
    { ownership: { kind: 'conversation' }, conversationId, background: true },
  );
  // The routine keeps its timezone, so changing RAHAT_PI_TIMEZONE later does not move it.
  state.routines[routineId] = { id: routineId, ...options, timezone, nextRunAt, enabled: true, deleted: false, taskId };
  return state.routines[routineId];
}
