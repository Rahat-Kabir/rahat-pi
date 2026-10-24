import { UserEntry, AssistantEntry, ToolResultEntry } from '@earendil-works/pi-durable';
import type { ConversationId, Cursor, EntryId, EntryRecord, Harness, Storage } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

// Failed inputs already cleaned up, per storage and conversation. This runs before every
// model request; without it, one old failure would re-read the whole history each time.
// A failed (terminal) turn never gains new entries, so handled inputs stay handled.
// In-memory only: the first request after a restart rescans once.
const handledFailedInputs = new WeakMap<Storage, Map<ConversationId, Set<EntryId>>>();

function handledInputsFor(storage: Storage, conversationId: ConversationId) {
  let byConversation = handledFailedInputs.get(storage);
  if (!byConversation) {
    byConversation = new Map();
    handledFailedInputs.set(storage, byConversation);
  }
  let handledInputs = byConversation.get(conversationId);
  if (!handledInputs) {
    handledInputs = new Set();
    byConversation.set(conversationId, handledInputs);
  }
  return handledInputs;
}

// Only terminal failures qualify. A placed input still belongs to Pi's resumable run.
export async function omitUnansweredTurns(harness: Harness, storage: Storage, conversationId: ConversationId) {
  const failedInputs = new Set<EntryId>();
  let cursor: Cursor | undefined;
  do {
    const page = await storage.scanSubmissions({ conversationId, status: 'unanswered' }, 200, cursor, context);
    for (const submission of page.items) {
      if (submission.type === 'input' && submission.entry !== undefined) {
        failedInputs.add(submission.entry);
      }
    }
    cursor = page.next;
  } while (cursor !== undefined);
  const handledInputs = handledInputsFor(storage, conversationId);
  if ([...failedInputs].every(failedInput => handledInputs.has(failedInput))) {
    return false;
  }
  const entries: EntryRecord[] = [];
  do {
    const page = await storage.scanEntries({ conversationId, order: 'ascending' }, 200, cursor, context);
    entries.push(...page.items);
    cursor = page.next;
  } while (cursor !== undefined);
  const alreadyOmitted = new Set(entries.flatMap(entry => (entry.edits ?? [])
    .filter(edit => edit.action === 'omit').map(edit => edit.target)));
  const conversation = await harness.conversation(conversationId, context);
  const activeContext = await conversation!.context(context);
  const visibleEntries = new Set(activeContext.entries.map(entry => entry.id));
  const targets: EntryId[] = [];
  let failedTurn = false;
  for (const entry of entries) {
    if (UserEntry.is(entry)) {
      failedTurn = failedInputs.has(entry.id);
    }
    if (failedTurn && (UserEntry.is(entry) || AssistantEntry.is(entry) || ToolResultEntry.is(entry))
      && visibleEntries.has(entry.id) && !alreadyOmitted.has(entry.id)) {
      targets.push(entry.id);
    }
  }
  if (targets.length > 0) {
    await harness.commit(transaction => transaction.appendEntry(conversationId, {
      kind: 'rahat.unanswered-context',
      edits: targets.map(target => ({ target, action: 'omit' as const })),
    }), context);
  }
  // Marked only after the omission is committed, so a failed commit is retried next request.
  for (const failedInput of failedInputs) {
    handledInputs.add(failedInput);
  }
  return targets.length > 0;
}
