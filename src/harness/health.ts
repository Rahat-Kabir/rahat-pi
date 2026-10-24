import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { ConversationId, Harness, TaskInspection } from '@earendil-works/pi-durable';
import { AppDoc, type Routine } from './state.js';

export type BlockedReason = Extract<TaskInspection['state'], { kind: 'blocked' }>['reason'];
// A task Pi will not run: parked after repeated crashes, or missing its code.
export type StoppedTask = {
  taskId: number;
  kind: string;
  label: string;
  reason: BlockedReason;
  restarts: number;
  // Only a task parked by the restart limit can be run again; the others need a code fix.
  canRetry: boolean;
};

type LiveTool = { callId: string; name: string };

// Plain words for the owner; the task kind stays available for debugging.
export function describeTask(
  inspection: TaskInspection,
  routines: Record<string, Routine>,
  liveTools: LiveTool[],
  rootConversationId: ConversationId,
) {
  const { kind, input, conversationId } = inspection.record;
  const taskInput = (input ?? {}) as { callId?: string; call?: { name?: string }; routineId?: string };
  switch (kind) {
    case 'pi.generation':
      return conversationId === rootConversationId ? 'Chat answer' : 'Helper answer';
    case 'pi.compaction':
      return 'Chat summary';
    case 'pi.tool': {
      // A model call stores only its call id; the live view knows the tool's name.
      const toolName = taskInput.call?.name ?? liveTools.find(tool => tool.callId === taskInput.callId)?.name;
      return toolName ? `Tool call (${toolName})` : 'Tool call';
    }
    case 'rahat.daily-briefing': {
      const routineName = taskInput.routineId === undefined ? undefined : routines[taskInput.routineId]?.name;
      return routineName ? `Routine "${routineName}"` : 'Routine';
    }
    default:
      return kind;
  }
}

export async function readStoppedTasks(harness: Harness, rootConversationId: ConversationId, liveTools: LiveTool[]): Promise<StoppedTask[]> {
  const inspection = await harness.inspect(context);
  const routines = (await harness.snapshot(AppDoc, context))?.routines ?? {};
  return inspection.tasks.flatMap(task => task.state.kind === 'blocked'
    ? [{
      taskId: Number(task.record.id),
      kind: task.record.kind,
      label: describeTask(task, routines, liveTools, rootConversationId),
      reason: task.state.reason,
      restarts: task.record.restarts ?? 0,
      canRetry: task.state.reason === 'restart_limit',
    }]
    : []);
}
