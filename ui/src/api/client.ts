import type { ActionDecisionRequest, ApiError, MessageRequest, MessageResponse } from '@api';

// Every write to the brain goes through here. The brain makes all safety decisions;
// this file only sends requests and reports what the brain answered.

export class ApiRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function post<ResponseBody>(path: string, token: string, body: unknown): Promise<ResponseBody> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Rahat-Token': token },
    body: JSON.stringify(body),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (result as ApiError | null)?.error ?? `Request failed (${response.status})`;
    throw new ApiRequestError(response.status, message);
  }
  return result as ResponseBody;
}

export function sendMessage(token: string, request: MessageRequest) {
  return post<MessageResponse>('/api/messages', token, request);
}

export function decideAction(token: string, request: ActionDecisionRequest) {
  return post<{ id: string; status: string }>('/api/actions', token, request);
}

// Turns API failures into a sentence the owner can act on.
export function describeError(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 403) {
    return 'The web token is missing or out of date. Paste the current contents of data/web-token.';
  }
  if (error instanceof ApiRequestError && error.status === 409) {
    return `The brain refused this: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
