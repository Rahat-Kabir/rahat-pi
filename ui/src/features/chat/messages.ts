import type { ChatMessage, InboxItem, WebState } from '@api';
import { describeToolCall, type ToolCallLine } from './toolCalls';

export type DisplayMessage = {
  key: string;
  role: 'user' | 'assistant' | 'tool' | 'other';
  text: string;
  // The model's visible reasoning, shown folded; empty when there is none.
  thinking: string;
  toolCalls: ToolCallLine[];
};

type ContentBlock = { type?: unknown; text?: unknown; thinking?: unknown; redacted?: unknown; name?: unknown; arguments?: unknown };

function contentBlocks(content: unknown): ContentBlock[] | null {
  return Array.isArray(content) ? content as ContentBlock[] : null;
}

// Message content comes from the model and tools: render it only as plain text.
// Thinking and tool calls are shown separately, so they are left out here.
export function contentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  const blocks = contentBlocks(content);
  if (!blocks) {
    return JSON.stringify(content, null, 2);
  }
  return blocks.flatMap(block => {
    if (block?.type === 'text') {
      return [String(block.text)];
    }
    if (block?.type === 'thinking' || block?.type === 'toolCall') {
      return [];
    }
    if (block?.type === 'image') {
      return ['[image]'];
    }
    return [JSON.stringify(block, null, 2)];
  }).join('\n');
}

function thinkingText(content: unknown) {
  return (contentBlocks(content) ?? [])
    // Redacted thinking is an encrypted payload with nothing readable in it.
    .filter(block => block?.type === 'thinking' && !block.redacted)
    .map(block => String(block.thinking ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function toolCallLines(content: unknown) {
  return (contentBlocks(content) ?? [])
    .filter(block => block?.type === 'toolCall')
    .map(block => describeToolCall(String(block.name), block.arguments));
}

function displayRole(role: string): DisplayMessage['role'] {
  if (role === 'user' || role === 'assistant') {
    return role;
  }
  return role === 'toolResult' ? 'tool' : 'other';
}

function toDisplay(key: string, message: ChatMessage): DisplayMessage {
  return {
    key,
    role: displayRole(message.role),
    text: contentText(message.content),
    thinking: thinkingText(message.content),
    toolCalls: toolCallLines(message.content),
  };
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
