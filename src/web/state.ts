import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { ConversationView, LiveState, InboxState } from '@earendil-works/pi-durable';
import { App } from '../harness/app.js';
import { AppDoc } from '../harness/state.js';

export async function readWebState(app: App, conversationView: ConversationView) {
  const state = await app.harness.snapshot(AppDoc, context);
  return {
    entries: conversationView.entries.map(entry => ({
      id: entry.id,
      kind: entry.kind,
      model: (entry.model ?? []).filter(message => message.role !== 'system').map(message => ({
        role: message.role,
        content: message.content,
      })),
    })),
    live: (conversationView.docs['pi.live'] ?? {}) as LiveState,
    inbox: (conversationView.docs['pi.inbox'] ?? { items: [] }) as InboxState,
    actions: Object.values(state?.actions ?? {}),
    subagents: await app.listSubagents(),
    memories: await app.listMemories(),
    stats: await app.stats(),
  };
}
export type WebState = Awaited<ReturnType<typeof readWebState>>;
