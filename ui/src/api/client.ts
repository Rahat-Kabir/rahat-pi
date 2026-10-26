import type {
  ActionDecisionRequest, ApiError, ForgetMemoryRequest, ForgetMemoryResponse, MessageRequest, MessageResponse,
  RetryTaskRequest, RetryTaskResponse, RoutineChangeRequest, RoutineChangeResponse, SessionResponse, SignInRequest,
} from '@api';

// Every write to the brain goes through here. The brain makes all safety decisions;
// this file only sends requests and reports what the brain answered.
// Sign-in lives in an HttpOnly cookie the browser sends by itself; scripts never see the token after sign-in.

export class ApiRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function post<ResponseBody>(path: string, body: unknown): Promise<ResponseBody> {
  return readResponse<ResponseBody>(await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

async function readResponse<ResponseBody>(response: Response): Promise<ResponseBody> {
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (result as ApiError | null)?.error ?? `Request failed (${response.status})`;
    throw new ApiRequestError(response.status, message);
  }
  return result as ResponseBody;
}

export function signIn(request: SignInRequest) {
  return post<SessionResponse>('/api/session', request);
}

// True when the browser holds a valid sign-in; false when the brain answers 401.
export async function checkSignedIn() {
  const response = await fetch('/api/session');
  if (response.status === 401) {
    return false;
  }
  await readResponse<SessionResponse>(response);
  return true;
}

export function sendMessage(request: MessageRequest) {
  return post<MessageResponse>('/api/messages', request);
}

export function decideAction(request: ActionDecisionRequest) {
  return post<{ id: string; status: string }>('/api/actions', request);
}

export function retryTask(request: RetryTaskRequest) {
  return post<RetryTaskResponse>('/api/tasks/retry', request);
}

export function forgetMemory(request: ForgetMemoryRequest) {
  return post<ForgetMemoryResponse>('/api/memories/forget', request);
}

export function changeRoutine(request: RoutineChangeRequest) {
  return post<RoutineChangeResponse>('/api/routines', request);
}

// Turns API failures into a sentence the owner can act on.
export function describeError(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 401) {
    return 'You are signed out. Reload the app and sign in with the contents of data/web-token.';
  }
  if (error instanceof ApiRequestError && error.status === 409) {
    return `The brain refused this: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
