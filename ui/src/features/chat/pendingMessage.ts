import type { MessageRequest } from '@api';

export type WhenBusy = NonNullable<MessageRequest['whenBusy']>;
export type PendingMessage = MessageRequest & { whenBusy: WhenBusy; requestId: string; botId?: string };

// If sending failed in an uncertain way (for example the network dropped after the
// brain admitted it), retrying the same text must reuse the same request ID so the
// brain admits it once. Different text, mode, or bot is a new message with a new ID.
export function nextPendingMessage(
  previous: PendingMessage | undefined,
  message: string,
  whenBusy: WhenBusy,
  botId: string | undefined,
  createRequestId: () => string,
): PendingMessage {
  if (previous && previous.message === message && previous.whenBusy === whenBusy && previous.botId === botId) {
    return previous;
  }
  return { message, whenBusy, botId, requestId: createRequestId() };
}
