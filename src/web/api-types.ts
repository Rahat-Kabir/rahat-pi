// The contract between the brain (src/) and the app (ui/).
// It imports nothing, so the browser app can type-check against it without brain code.
// It lists only the fields the app relies on; tests/api-contract.test.ts fails to
// compile if the brain's real state stops fitting these types.
// Everything except POST /api/session and the app's own files needs a sign-in: the
// session cookie that POST /api/session sets, or the `X-Rahat-Token` header with the
// contents of data/web-token. Without one, the brain answers 401.

// `content` is a string or an array of blocks such as { type: 'text', text } and
// { type: 'toolCall', name, arguments }. Treat all of it as untrusted text.
export type ChatMessage = { role: string; content: unknown };
export type ConversationEntry = { id: number; kind: string; model: ChatMessage[] };

export type LiveToolCall = {
  callId: string;
  name: string;
  status: 'pending' | 'running' | 'done';
  output?: string;
};
export type LiveState = {
  // Present exactly while the agent is working.
  run?: { taskId: number; inputs: number[] };
  // The answer being written right now.
  generation?: { message?: ChatMessage & { errorMessage?: string } };
  tools?: LiveToolCall[];
  compactionFailure?: { error: string };
};
export type InboxItem =
  | { id: number; mode: 'steer' | 'followUp'; content: unknown }
  | { id: number; mode: 'write' };

export type ActionStatus = 'proposed' | 'approved' | 'executing' | 'succeeded' | 'failed' | 'unknown' | 'rejected';
export type Action = {
  id: string;
  kind: 'send_message';
  payload: { recipient: string; body: string };
  payloadHash: string;
  status: ActionStatus;
  expiresAt: number;
  approvedAt: number | null;
  providerReceipt: string | null;
  error: string | null;
};

export type Subagent = {
  taskId: number;
  title: string;
  startedAt: number;
  answer: string | null;
  status: string;
};

// Stored facts the agent remembers, newest first. Treat content as untrusted text.
export type Memory = {
  id: string;
  content: string;
  // Who or what the fact came from, for example 'owner' or a web address.
  source: string;
  createdAt: number;
};

// A daily routine, earliest time of day first: at `time` (HH:mm) in its own fixed-offset
// `timezone`, the agent receives `prompt`. `nextRunAt` is not meaningful while paused.
// Treat name and prompt as untrusted text.
export type RoutineRun = { occurrenceTime: number; status: 'running' | 'succeeded' | 'failed' };
export type Routine = {
  id: string;
  name: string;
  prompt: string;
  time: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: number;
  lastRun: RoutineRun | null;
};

// A task Pi will not run: parked after repeated crashes (`canRetry`), or blocked on
// missing or unmigratable code. `label` is plain words, for example 'Routine "Daily briefing"'.
export type StoppedTask = {
  taskId: number;
  kind: string;
  label: string;
  reason: 'restart_limit' | 'missing_task' | 'task_too_old' | 'migration_failed';
  restarts: number;
  canRetry: boolean;
};

export type Spend = {
  actualUsd: number;
  openReservedUsd: number;
  unknownReservedUsd: number;
  countedUsd: number;
  requests: number;
  unknownRequests: number;
};
export type Stats = {
  day: string;
  timezone: string;
  today: Spend;
  total: Spend;
  actions: Record<ActionStatus, number>;
  subagents: Record<string, number>;
};

// GET /api/state, and each `state` event of GET /api/events (which also carries
// `html` for the old page).
export type WebState = {
  entries: ConversationEntry[];
  live: LiveState;
  inbox: { items: InboxItem[] };
  actions: Action[];
  subagents: Subagent[];
  memories: Memory[];
  routines: Routine[];
  stoppedTasks: StoppedTask[];
  stats: Stats;
};

// POST /api/session → 200 SessionResponse and a long-lived HttpOnly cookie; 401 for a wrong token.
// GET /api/session → 200 SessionResponse when signed in, otherwise 401.
export type SignInRequest = { token: string };
export type SessionResponse = { signedIn: true };

// POST /api/messages → 202 MessageResponse
export type MessageRequest = {
  message: string;
  whenBusy?: 'steer' | 'followUp';
  // Reuse the same ID when retrying an uncertain submission, so it is admitted once.
  requestId?: string;
};
export type MessageResponse = { submissionId: number };

// POST /api/actions → 200 with the updated action; 409 when the payload changed.
export type ActionDecisionRequest = {
  decision: 'approve' | 'reject';
  id: string;
  // The hash of the payload the owner saw.
  payloadHash: string;
};

// POST /api/tasks/retry → 200 RetryTaskResponse; 409 when the task is not stopped or cannot be retried.
export type RetryTaskRequest = { taskId: number };
export type RetryTaskResponse = { retried: number; label: string };

// POST /api/memories/forget → 200 ForgetMemoryResponse; 409 when no memory has that id.
export type ForgetMemoryRequest = { id: string };
export type ForgetMemoryResponse = { forgotten: string };

// POST /api/routines → 200 RoutineChangeResponse; 409 when no routine has that id.
// Resuming skips runs missed while paused. Deleting keeps the routine's history in the brain.
export type RoutineChangeRequest = { id: string; change: 'pause' | 'resume' | 'delete' };
export type RoutineChangeResponse = { id: string; status: 'active' | 'paused' | 'deleted' };

// Web push. Pushes carry no content: they wake the service worker, which asks for the text.
// GET /api/push/key → 200 PushKeyResponse, the key to pass to pushManager.subscribe().
export type PushKeyResponse = { publicKey: string };
// POST /api/push/subscribe and /api/push/unsubscribe → 200 PushSubscriptionResponse; 400 unless https.
// A new subscription starts at the newest notification, so old ones are not replayed.
export type PushSubscriptionRequest = { endpoint: string };
export type PushSubscriptionResponse = { subscribed: boolean };
// POST /api/notifications/pending → 200 PendingNotificationsResponse, oldest first, at most 20;
// 409 when the endpoint is not subscribed.
export type AppNotification = { id: string; seq: number; title: string; body: string; createdAt: number };
export type PendingNotificationsRequest = { endpoint: string };
export type PendingNotificationsResponse = { notifications: AppNotification[] };
// POST /api/notifications/shown → 200 NotificationsShownResponse, after showing up to `seq`.
export type NotificationsShownRequest = { endpoint: string; seq: number };
export type NotificationsShownResponse = { shownSeq: number };

// Any non-2xx response.
export type ApiError = { error: string };
