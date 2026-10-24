import type { MessageRequest } from '@api';

export type WhenBusy = NonNullable<MessageRequest['whenBusy']>;
export type PendingMessage = MessageRequest & { whenBusy: WhenBusy; requestId: string };

// If sending failed in an uncertain way (for example the network dropped after the
// brain admitted it), retrying the same text must reuse the same request ID so the
// brain admits it once. Different text or mode is a new message with a new ID.
export function nextPendingMessage(
  previous: PendingMessage | undefined,
  message: string,
  whenBusy: WhenBusy,
  createRequestId: () => string,
): PendingMessage {
  if (previous && previous.message === message && previous.whenBusy === whenBusy) {
    return previous;
  }
  return { message, whenBusy, requestId: createRequestId() };
}
