import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { Harness, TaskInspection } from '@earendil-works/pi-durable';
import { AppDoc, type Routine } from './state.js';
import { defaultBotId, type Bot } from './bots.js';

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
  botByConversation: Map<number, Bot>,
) {
  const { kind, input, conversationId } = inspection.record;
  const taskInput = (input ?? {}) as { callId?: string; call?: { name?: string }; routineId?: string };
  switch (kind) {
    case 'pi.generation': {
      const bot = botByConversation.get(conversationId);
      // A conversation no bot owns is a subagent's child.
      if (!bot) {
        return 'Helper answer';
      }
      return bot.id === defaultBotId ? 'Chat answer' : `Chat answer (${bot.name})`;
    }
    case 'pi.compaction':
      return 'Chat summary';
    case 'pi.tool': {
      // A model call stores only its call id; the live view knows the tool's name.
      const toolName = taskInput.call?.name ?? liveTools.find(tool => tool.callId === taskInput.callId)?.name;
      return toolName ? `Tool call (${toolName})` : 'Tool call';
    }
    case 'rahat.daily-briefing': {
      const routineName = taskInput.routineId === undefined ? undefined : routines[taskInput.routineId]?.name;
      const bot = botByConversation.get(conversationId);
      // The briefing task lives in its bot's conversation; name bots other than the default.
      const botSuffix = bot && bot.id !== defaultBotId ? ` (${bot.name})` : '';
      return routineName ? `Routine "${routineName}"${botSuffix}` : 'Routine';
    }
    default:
      return kind;
  }
}

export async function readStoppedTasks(
  harness: Harness,
  bots: Bot[],
  liveToolsByConversation: Map<number, LiveTool[]>,
): Promise<StoppedTask[]> {
  const inspection = await harness.inspect(context);
  const routines = (await harness.snapshot(AppDoc, context))?.routines ?? {};
  const botByConversation = new Map<number, Bot>(bots.map(bot => [bot.conversationId, bot]));
  return inspection.tasks.flatMap(task => task.state.kind === 'blocked'
    ? [{
      taskId: Number(task.record.id),
      kind: task.record.kind,
      label: describeTask(task, routines, liveToolsByConversation.get(task.record.conversationId) ?? [], botByConversation),
      reason: task.state.reason,
      restarts: task.record.restarts ?? 0,
      canRetry: task.state.reason === 'restart_limit',
    }]
    : []);
}
