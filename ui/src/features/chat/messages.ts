import type { ChatMessage, InboxItem, WebState } from '@api';

export type DisplayMessage = {
  key: string;
  role: 'user' | 'assistant' | 'tool' | 'other';
  text: string;
};

// Message content comes from the model and tools: render it only as plain text.
export function contentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(block => {
      if (block?.type === 'text') {
        return String(block.text);
      }
      if (block?.type === 'toolCall') {
        return `Tool: ${block.name} ${JSON.stringify(block.arguments, null, 2)}`;
      }
      return JSON.stringify(block, null, 2);
    }).join('\n');
  }
  return JSON.stringify(content, null, 2);
}

function displayRole(role: string): DisplayMessage['role'] {
  if (role === 'user' || role === 'assistant') {
    return role;
  }
  return role === 'toolResult' ? 'tool' : 'other';
}

function toDisplay(key: string, message: ChatMessage): DisplayMessage {
  return { key, role: displayRole(message.role), text: contentText(message.content) };
}

export function transcript(state: WebState): DisplayMessage[] {
  return state.entries.flatMap(entry => entry.model.map((message, index) => toDisplay(`${entry.id}:${index}`, message)));
}

// The answer being written right now, or null when idle.
export function liveAnswer(state: WebState): DisplayMessage | null {
  const message = state.live.generation?.message;
  return message ? toDisplay('live', message) : null;
}

export function runFailure(state: WebState): string | null {
  return state.live.compactionFailure?.error ?? state.live.generation?.message?.errorMessage ?? null;
}

export function queuedText(item: InboxItem): string {
  return 'content' in item ? contentText(item.content) : 'Pending write';
}
