# As-built architecture

Verified with Node 22.23.4. Direct dependencies are exact-pinned in package.json and
package-lock.json: Pi Durable, pi-ai, and Chord **1.4.0**, commander 15.0.0,
dotenv 18.0.9. TypeScript ESM runs through tsx. No alternative harness is used.

## Process and harness

`src/cli.ts` parses owner commands. It attaches to the service's Unix socket when
available; otherwise it opens an App for that operation. `src/main.ts` runs the
scheduler and fake executor. The socket is mode 0600, inside the data directory
(set to mode 0700 on every open, even if it already existed). It is not an Internet gateway; local OS access is owner authority.
Chord's kernel-owned `processLock`, keyed by the real data-directory path, prevents
multiple processes opening Pi storage. On Linux its abstract socket vanishes on
SIGKILL, so there is no stale PID lock. A stale service socket is removed only after
acquiring that lock. Concurrent standalone commands fail clearly when another owns it.

`src/harness/app.ts` opens `data/pi.sqlite` through `openPiStorage` (WAL, `synchronous=FULL`;
chord's default NORMAL can lose the newest commits on power loss), installs the
`rahat.personal` extension, and creates/reopens the root conversation. Tools and
model configuration are reapplied on open. Pi persists model steps, tool tasks,
transcripts, request IDs, and document commits. `watchEvents` drives live tool-call display. Final assistant text is read from the
committed answer and printed once after completion, avoiding incomplete event deltas. The curated profile is a system section. The main agent has the four confined
workspace tools described below. No browser, host coding, approval, or executor
tools are installed. The main agent can delegate
through `subagent_run`; children have a narrower allowlist.

The build inspected the shipped READMEs, declarations, runtime implementations,
and README examples. The official Pi Durable 1.4.0 examples (in the
[Pi repository](https://github.com/earendil-works/pi), `packages/durable/test/examples`)
provide the foreground/background subagent and child-task patterns. APIs used
here are those shipped in 1.4.0; the community 1.2.0 library is not a dependency.
Background: [Pi Durable announcement](https://earendil.com/posts/pi-durable/).

## Application documents and memory

`src/harness/state.ts` defines the session-scoped `rahat.app` Pi document. Its
records hold memories, actions, routines, unique routine runs, run budgets, and
daily reservations. Every mutation uses Pi's serialized commit line. Typed draft
proxies are detached with JSON serialization before leaving a commit.

`memory_write` keys facts by durable tool-task ID, making replay idempotent. Each
fact stores content, source, creation time, and `trust: data`. `memory_forget`
removes a local fact; it is replay safe. `memory_search` builds an FTS5 index from
current authoritative facts, quotes query tokens, and returns at most 20 results
with provenance. The profile contains the owner's name and timezone; retrieved facts
and Calendar text are explicitly untrusted data. They never become prompt sections.
This prevents instruction promotion; it cannot guarantee a model ignores injection.

Both Pi's store and memory FTS use Node's built-in `node:sqlite`. It supplies FTS5
on the verified Node version, so better-sqlite3 is unnecessary. The FTS index is
in-memory and rebuilt for each search: losing it cannot lose facts or expose a
forgotten fact. This is deliberately small-scale for now.

## Routines

`src/extensions/routines.ts` registers `rahat.daily-briefing`, a real Pi durable
task. Its wait phase commits `sleepUntil(nextRunAt)` and holds no invocation while
sleeping. The next phase claims a unique `routineId:occurrenceTime` record and
advances nextRunAt in the same commit. Its delivery checkpoint submits the prompt
to the main conversation using the occurrence ID as Pi `requestId`, then waits for
that submission. A crash after claim or admission resumes the same checkpoint;
submission deduplication prevents a second briefing. Results stay in the main
conversation and RoutineRun records status plus submission ID.

Schedules are daily HH:mm in the routine's stored timezone (from `RAHAT_PI_TIMEZONE`; fixed offset, no DST).
`catchUpOnce` selects only the latest due occurrence, not every missed day.
`skip` advances to tomorrow if the latest occurrence is at least 60 seconds late;
ordinary scheduling jitter below a minute still runs. Pause/delete disable the
routine; the watchdog aborts its durable task. Delete retains audit records.
Stop aborts all background tasks; service start/tick rearms enabled terminal timers.
An explicitly aborted in-flight briefing is marked failed and is not rerun for
that occurrence. Changing the prompt requires creating a new routine.

Owner commands (not agent tools): `routines` lists live routines by time of day, each
with its latest run; `routine pause|resume|delete <id>` changes one, and an unknown or
deleted id is an error. Resume first stops the paused task if the watchdog has not
yet, then in one commit sets `enabled`, moves `nextRunAt` to the next future time
(runs missed while paused are skipped, whatever `missedRunPolicy` says), and creates
a fresh task. The agent still has no resume tool.

`RAHAT_PI_NOW` fixes the application/Pi clock for restart tests. Sleep deadlines and
occurrence IDs use that clock; real wall deadlines are also enforced. All processes
opening the same data must use the same clock. There is no fake-time option in the
model's tools.

## Approvals and fake execution

`src/executor/actions.ts` canonicalizes finite JSON with sorted object keys and
hashes `{kind: "send_message", payload}` using SHA-256. Proposals contain the exact
recipient/body and expire 24 hours after proposal creation. Approval records owner,
time, and the matching hash. CLI edit resets status, hash, expiry, and approval.

Lifecycle: proposed → approved → executing → succeeded | failed | unknown.
Rejected is an additional terminal owner decision. Expiry or changed hashes fail
before dispatch. The policy allowlist only exposes `propose_send_message` for sends;
it creates a proposal keyed by Pi task ID. Approval is exclusively an owner command.
Read-only `action_status` lets the model check one proposal by id, or the 10 newest,
from stored state: status, receipt, error, and an `expired` flag for a stale
proposal. It never reconciles or sends; the system prompt tells the model to call it
instead of guessing a send's outcome from chat. Subagents cannot call it.

`src/executor/index.ts` commits executing before entering the fake sender.
`src/executor/fake-sender.ts` uses a separate `data/fake-provider.sqlite` outbox with
FULL synchronous WAL commits, unique action-ID idempotency keys, exact payloads,
and provider receipts. Matching key/payload returns the original receipt; a changed
payload for that key fails. No real sends or credentials are involved.

On opening the app, every interrupted executing action becomes unknown. Read-only
`actions` exposes that uncertainty without reconciliation or model access. Service
and tick reconcile by provider lookup before handling approved actions. A matching
receipt changes unknown to succeeded. No receipt leaves unknown indefinitely,
including a crash between the executing commit and actual dispatch. There is no
blind retry or CLI override. Provider exceptions after entry also remain unknown.
Exactly-once effects here rely on the fake provider's durable unique-key contract;
this is not a claim about future email providers.

## Unanswered conversation context

`src/harness/conversation-context.ts` reads Pi's terminal `unanswered` submissions.
Before generation prepares its request, the profile section appends immutable
`edits: [{target, action: "omit"}]` for the failed user input and its partial
assistant/tool entries, ending at the next input. System entries remain to preserve
Pi's positional prompt/tool loadout. Repeated preparation finds existing edits and
does not append duplicates. Raw durable history is never deleted or rewritten.
Failed inputs whose omission is committed are remembered in memory per storage and
conversation, so later requests skip the full-history scan until a new failure
appears. A terminal turn gains no new entries; after a restart the first request
rescans once.
This excludes failures before dispatch, mid-run token/deadline failures, provider
errors, and terminal aborts from later model requests. Already performed tool effects
are not rolled back; approvals remain governed by their separate durable records.

A merely crash-interrupted input remains `placed`, so no omission applies and Pi
resumes its generation/tool checkpoint normally. Manual compaction applies omissions
before selection; the compaction hook declines an obsolete selection if cleanup
adds edits after selection. Later selection reads the cleaned context, so failed
instructions are not carried into a new summary. Existing summaries made before
this fix cannot be reliably untangled into their original inputs.

## Subagents

`src/extensions/subagents.ts` provides `subagent_run({task, title?})`. It follows
Pi 1.4.0 example 22: the main conversation's tool task owns a child conversation.
Creation and admission commit together in a new session document, `rahat.subagents`;
existing `rahat.app` records/formats are unchanged. Replay finds the child by the
same tool-task ID and submits with `requestId: subagent:<taskId>`. The saved final
answer is returned through that same durable tool task, producing one parent tool
result. A saved answer survives a later deadline; unfinished work times out.
Exactly-once delivery means one committed parent tool result, not one terminal
print across repeated CLI requests. Provider work interrupted mid-request may be
reissued and charged again; attempts without reported usage keep their full reservation.

The child model is `RAHAT_PI_SUBAGENT_MODEL`, default `anthropic/claude-haiku-5.5` through
OpenRouter (the main default is `anthropic/claude-sonnet-5.5`). Both exist in pi-ai 1.4.0's
pinned catalog. Haiku 5.5 costs USD 0.10 input / 0.50 output / 0.01 cached input per million
tokens, rising to 0.50 / 2.50 / 0.05 for requests above 100K input tokens. Both models think
by default, so their thinking counts toward `RAHAT_PI_MAX_OUTPUT_TOKENS`.
Unknown configured model IDs fail on open. Offline mode uses the same faux
provider for parent and child. A child's model is selected at creation; changing
the environment affects new children. Children receive the task, inherited profile,
and their own instructions/history, without copying the parent's transcript.

The child tool allowlist is `memory_search`, `calendar_list_events`, and
`web_fetch` (added with web research).
`beforeTool` also checks Pi's ownership record, so accidentally re-enabling tools
cannot permit mutations or grandchildren. The creation boundary independently
rejects delegation from task-owned conversations. The registry retains the policy
extension on children so its blocking hooks remain active.

Defaults: 8 tool calls and 90,000 ms per child; positive env settings
`RAHAT_PI_SUBAGENT_MAX_TOOL_CALLS` (integer) and `RAHAT_PI_SUBAGENT_MAX_MS` override
them. The creation timestamps persist across restart. Tool/model guards enforce
deadlines before dispatch, and the 50 ms watchdog aborts overdue owner tool tasks,
cancelling their children and in-flight requests. Parent run limits and stop can
end a child earlier. Counters reuse tool-call IDs across replay.

At most two owner tool tasks can be active. A third is rejected with a retry
message; no queue is added. Slots release when the owner task becomes terminal,
including aborts/failures. Harness tool scheduling defaults to parallel; all prior
tools explicitly retain sequential execution. A round containing a sequential
tool stays sequential. A round of delegation calls can run two children together.

`rahat-pi subagents` lists retained child IDs, titles, timestamps, saved answers,
and statuses derived from owner tool tasks (`running`, `completed`, `aborted`,
`failed`, or `faulted`). Pi can report a tool's error result as task-completed;
a terminal tool without a saved child answer is listed as failed. There is no
background spawn/send API, persistent named worker, individual stop command, or
history pruning yet. Foreground ownership makes the existing stop
cascade sufficient; no additional reporter task is needed.

## Compaction

`src/harness/app.ts` enables Pi 1.4.0's built-in `CompactionTask` for the main
model. At generation preparation, Pi blocks above `RAHAT_PI_COMPACT_AT_TOKENS`
(default 40,000), using its usage/estimate-based context count. This maps to
`reserveTokens = contextWindow - threshold`; the threshold must be a positive
integer below the model context window. The default leaves headroom for both
summary and continuation under the conservative byte-based 300,000-token run cap;
large individual turns can still exceed it. Recent context retained verbatim is
`min(8000, floor(threshold / 4))` tokens. Background summarization is disabled;
Pi also handles provider context overflow with a guarded compaction attempt.
A blocking hook declines child compaction even when child and main models match.

`rahat-pi compact` admits `root.compact()` with instructions to preserve key facts,
exact names/values, preferences, decisions, and unfinished work. It reuses an
already-running compaction after restart, waits for the task and its summary write
submission, and returns `{compacted, taskId, entryId?, submissionId?}`. An empty or
too-short context returns `compacted: false` without a model request. Commands
use the existing serialized App dispatch, standalone or over the owner socket.

The built-in task selects a safe prefix, summarizes it, and atomically places a
`CompactionEntry` pointing at the first retained entry. It never removes original
entries or touches `rahat.app.memories`; FTS queries rebuild from those facts.
The profile remains a separately rendered system section on subsequent requests.
Pi's summary prompt preserves goals, constraints, decisions, and critical context;
model summaries are lossy, so durable facts should still use memory tools.

Pi calls `Models.completeSimple` for compaction, bypassing the prior streaming
guard. `budgetCompactionModels` in `src/harness/models.ts` guards that boundary,
replaces the request model with `RAHAT_PI_SUMMARY_MODEL` (default the configured
cheap subagent model), and enforces `RAHAT_PI_MAX_OUTPUT_TOKENS`. Unknown live
summary models fail against the pinned catalog. No new dependency/provider was
added. Offline summaries use faux and echo the selected source; a scripted concise
response separately proves the context shrinks.

Before provider dispatch, the same `reserveModelRequest` validates the provider
session, stop flag, token/wall limits, pricing, and shared daily USD cap. Automatic
summaries charge the active parent run; manual summaries have a persisted budget
key `compaction:<taskId>` in the existing App document format. Both use the same
configured run limits. Pi exposes only a conversation session at this model boundary;
if manual and automatic tasks overlap, new summary requests fail closed until
only one task remains, preventing charges against the wrong budget. The watchdog also aborts overdue manual tasks. The budget
initialization now reads the assigned record back through the document proxy so
the first request's token increment persists (previously only daily USD persisted).
Pi's own usage document separately records returned summary usage under its actual
model. Reservations are conservative, retained on errors, and never billing receipts.

Crash hooks: `compaction_started` runs after reservation and before provider entry;
`compaction_summary_ready` runs after the provider response and before Pi places
it. At either kill, original history is intact. Restart resumes the durable task,
reserves again for a possibly repeated paid request, and places one summary.
A cap/deadline may prevent completion while preserving history. Incomplete, empty,
tool-calling, or failed summaries are not placed by Pi. The two SIGKILL tests verify
one summary, every original entry exactly once, retained memory, and continued chat.

Compaction deviations: blocking automatic compaction was chosen over background work
so it shares the active run's budget and deadline. Manual compaction uses the same
recent-context policy, so a short conversation may be a no-op. No history pruning,
summary editing, or live provider validation was added. Output-limit failures may
require a larger approved `RAHAT_PI_MAX_OUTPUT_TOKENS`; no partial summary is used.

## Local web UI

`rahat-pi web` calls `runService(config, true)`: the same App, scheduler, executor,
and Unix owner socket, plus `src/web/server.ts` using built-in `node:http`.
`run`/`start` retain their socket-only behavior. This explicit command avoids
occupying an HTTP port for existing CLI-only services. Only one service can own a
data directory; `web` does not attach another process to an already-running `run`.
No dependencies, providers, or model defaults were added or changed.

The HTTP listener binds exclusively `127.0.0.1`, using `RAHAT_PI_WEB_PORT` (default
8787; integer 1–65535). Tests pass port 0 directly to `startWebServer` for ephemeral
ports. Every route requires exactly `127.0.0.1:<actualPort>` or
`localhost:<actualPort>` in Host. Other Host values get 403, blocking DNS rebinding.
The first start generates 32 random bytes and saves their hex encoding to
`<dataDir>/web-token`, chmod 0600, logging only the path. Later starts reuse a valid
saved token (64 hex characters) so signed-in devices stay signed in; a missing or
damaged file gets a new one. Deleting the file and restarting signs every device out.

Every route except `POST /api/session`, `/client.js`, and the app files under `/app/`
(which hold no owner data) needs a sign-in, compared in constant time: the
`rahat_session` cookie or the `X-Rahat-Token` header (used by scripts and the old
page's POSTs). Without one: 401, except `GET /`, which redirects (303) to `/app/`.
`POST /api/session` with `{token}` sets the cookie to the token with `HttpOnly;
SameSite=Strict; Path=/; Max-Age` 400 days (the browser maximum); a wrong token gets
401 and no cookie. `GET /api/session` answers 200 when signed in. HttpOnly keeps
page scripts from reading the token; SameSite=Strict plus required
application/json POST bodies and no CORS headers block cross-site use. The cookie is
not `Secure` yet: the listener is plain HTTP on loopback. No token is served by GET
or placed in URLs. No environment/config/key endpoint exists. One owner token; this is
not multi-user auth.

Responses are no-store, disallow cross-origin reads (no CORS headers), and set
CSP (self scripts/connections, no frames, base URLs, or external resources),
nosniff, and no-referrer. Only inline CSS is allowed. All transcript, tool, child,
and payload text is HTML-escaped before insertion; model output cannot create
scripts or approval controls. JSON bodies are limited to 64 KiB and decoded as
streaming UTF-8. No remote deployment or reverse-proxy mode is included.

`src/web/state.ts` projects Pi's root `viewState()` into active entries (model
role/content only, excluding system messages), `pi.live`, and `pi.inbox`, plus App
actions and the existing `listSubagents()` statuses. Provider settings and tool
schemas are not served. `src/web/page.ts` renders that state as escaped HTML;
`client.js` replaces only the state panel, preserving the message draft/token.
`GET /` serves the initial page, `/client.js` its script, and `/api/state` JSON.
`GET /api/events` sends SSE full-state frames on Pi view changes and AppDoc watch
updates, including approval/executor status changes while chat is idle. Shared
refresh work is serialized. Frames include the projected state and rendered HTML.
A 15-second heartbeat detects closed connections; clients with over 1 MiB already
queued are disconnected and recover from a fresh snapshot. Full transcript frames
favor simplicity over large-history bandwidth efficiency.

`POST /api/messages` accepts `{message, whenBusy?, requestId?}` and returns 202
with `{submissionId}` after durable admission, without waiting for an answer.
`App.submitMessage()` checks stop/closed/key state and calls real Pi 1.4.0
`root.submit({type: "input", content, whenBusy, requestId})`. Follow-up is default;
steer joins the running work at Pi's tool boundary. Neither waits behind the CLI
chat-completion queue. Existing model/tool reservation guards apply unchanged.
The browser retains a request ID for retries of the same uncertain submission
while the page stays open. A page reload loses that pending ID; the API accepts
owner-provided IDs for retry across reloads/restarts. SSE never resubmits input.

`POST /api/actions` accepts `{decision: "approve" | "reject", id, payloadHash}`.
It invokes `app.dispatch`, the existing CLI command path. That path compares the
optional expected hash inside the same Pi commit that updates the action, then
uses unchanged `approveAction` expiry/hash validation or rejection rules. HTTP
requires the hash; existing CLI arguments/formats and crash hooks are unchanged.
A stale hash returns 409, missing sign-in 401, wrong Host 403, malformed input 400/415, oversized
input 413. The existing executor remains the sole sender. New HTTP crash tests
exercise `action_approved` and `after_dispatch`, with one fake outbox row after
restart/reconciliation and no blind resend.

Memories are part of the live state (`memories`, newest first), so the app updates
when the agent remembers or forgets something. `POST /api/memories/forget` accepts
`{id}` and runs the owner `forget` command (also `npm run cli -- forget <id>`;
`npm run cli -- memories` lists them). An unknown id is an error (409), unlike the
agent's `memory_forget`, which always reports success. Forgetting deletes the stored
fact and its search entry; earlier chat history or a compaction summary that
mentions the fact is not rewritten.

Routines are part of the live state too (`routines`, the owner `routines` list).
`POST /api/routines` accepts `{id, change}` with change `pause`, `resume`, or
`delete`, runs the matching owner command, and answers `{id, status}`; an unknown or
deleted id is 409.

EventSource retries every second and acquires the current durable snapshot; no
SSE event history/cursor needs persistence. The web command resumes Pi tasks on
start. `scripts/web-snapshot.ts` (`npm run web:snapshot`) fetches `/api/state` from
the running server (sending `X-Rahat-Token` from the token file) and uses the same renderer to save `<dataDir>/web-snapshot.html`
without scripts or token. Offline tests also leave a representative snapshot in
`data/web-snapshot.html`; snapshots contain personal conversation/action data.

Web UI deviations and gaps: the dedicated `web` command was chosen from the two
allowed designs; `run` itself does not expose HTTP. SSE uses complete state frames,
not deltas. The transcript follows Pi's active view after compaction, rather than
browsing every historical entry retained in storage. There is no browser automation
or live model verification yet; offline HTTP/faux/SIGKILL checks cover
the data path and escaped HTML. No remote auth, history pagination, payload editor,
or child-control UI was added. Calendar and outbound sends remain fixtures.

## App (M2, in progress)

`ui/` is a React 19 + TypeScript + Vite 8 + Tailwind 4 app with its own exact-pinned
`package.json`. It builds static files into `ui/dist/` (git-ignored); the web server
serves them at `/app/` and the old page stays at `/` until the app replaces it. The
brain and the app meet only through HTTP. `src/web/api-types.ts` is the contract: it
imports nothing, so the app type-checks against it without brain code
(`import type … from '@api'`, a tsconfig path the bundler never resolves, so a runtime
import from the brain fails the build). It lists only fields the app uses;
`tests/api-contract.test.ts` fails `tsc` if the brain's real state stops fitting it.

`src/web/app-files.ts` serves only regular files inside the app folder with a known
extension. The URL path is decoded once, then the resolved and real paths must stay
inside the folder, so encoded traversal and escaping symlinks get 404. Before
`npm run ui:build`, `/app/` answers 404 with that hint. CSP adds `'self'` for
styles, images, fonts, and the manifest; `'unsafe-inline'` styles remain for the old
page's `<style>` block and React style attributes. Scripts stay `'self'` only.

Safety stays in the brain. The app renders tool, payload, thinking, and owner text as
React text (escaped), never as HTML. Assistant replies render as CommonMark through
`react-markdown` (`ui/src/features/chat/MarkdownText.tsx`): raw HTML stays text (no
`rehype-raw`), unsafe link schemes are dropped, links open with `noopener noreferrer`,
and images show as `[image: alt (url)]` text, never loaded, so an injected image URL
cannot leak chat text (CSP `img-src 'self'` would also block it). No GFM: tables and
strikethrough show as plain text. Approval cards send the hash of the payload they
show; approve appears only for `proposed`, reject (cancel) also for `approved`. The
composer keeps one request ID per unsent text, so retrying an uncertain send is
admitted once. Tool calls show as one plain-language line each (`ui/src/features/chat/toolCalls.ts`,
for example `Searched memory for "tea"`), with the raw arguments folded under it;
unknown tools fall back to `Used <name>`. Readable thinking is folded under
"Thinking"; redacted thinking and signatures are never shown. On narrow screens
(below Tailwind's `lg`), a pinned amber banner counts approvals waiting for the owner
and scrolls to them, and the approvals panel moves above the chat while any wait
(capped at 60% of the screen height, scrolling inside). On load the app asks `GET /api/session`; signed out, it shows a
one-time sign-in form that posts the token to `POST /api/session` and keeps nothing
itself. Signed in, the browser sends the cookie on every request. Live updates use the
existing SSE stream; a refused stream (for example after the token file was replaced)
makes the app check its sign-in again. Remote access (for example Tailscale with HTTPS)
is not set up yet; adding it also needs `Secure` cookies and its Host name allowed. The manifest and PNG/SVG icons make it installable in Chromium browsers; there
is no service worker or offline mode. A Chat | Memories | Routines switch sits above
the main column. The memories view lists `state.memories` (newest first, with source
and save time) and forgets one after an inline "Forget this for good?" confirmation.
The routines view shows each routine's schedule, prompt, next and latest run (in the
routine's own timezone), with Pause/Resume and Delete after a "Delete this routine?"
confirmation. Done so far: chat, approvals, memories, routines. Still open:
notifications, activity, removing the old page.

## Sandboxed workspace tools

`src/extensions/workspace.ts` owns file access and bubblewrap execution. App opens
one workspace at `<real dataDir>/workspace/` and registers `workspace_list`,
`workspace_read`, `workspace_write`, and `workspace_shell` as sequential main-agent
tools. The code allowlist admits all four. Children retain memory search, Calendar reads, and web fetch; the ownership hook rejects all workspace tools even if their
schemas are accidentally enabled. No database formats or existing CLI commands changed.

File paths are relative to the workspace. Absolute paths and traversal outside
it are rejected. Both parent and existing target are checked with `realpath` and
separator-aware containment; an escaping or dangling symlink cannot be written.
Internal symlinks are allowed. The workspace root itself cannot be a symlink.
File descriptors use `O_NOFOLLOW` and `O_NONBLOCK`, and only regular files are
accepted; writes also reject multiple hard links before truncation. Parent
directories must exist (use shell `mkdir` for nested directories). Reads and writes
are UTF-8, capped at 65,536 bytes; oversized reads/writes fail. Lists return at most
256 names and a `truncated` flag without following entry symlinks.

`workspace_shell({command})` runs `/bin/sh -c` through `/usr/bin/bwrap`, never through
a host shell. The reference Linux host verified bubblewrap 0.12.0 and
`unshare --user --map-root-user --net true`. Options include `--unshare-all`, explicit
`--unshare-user` and `--unshare-net`, `--disable-userns`, `--cap-drop ALL`,
`--die-with-parent`, and `--new-session`. Bubblewrap requires explicit
`--unshare-user` for `--disable-userns` even alongside `--unshare-all`.
The new mount namespace exposes read-only `/usr`, merged-usr `/bin`,
`/lib`, `/lib64` symlinks, private `/proc` and minimal `/dev`, and a fresh tmpfs
`/tmp`. No `/etc` files are required for the tested shell/Python utilities.
Only the workspace is bound read-write, at `/workspace`, which is also cwd and HOME.
The repo, `.env`, Pi/fake-provider databases, web token, and owner socket are absent.
A private network namespace blocks IP and host abstract Unix sockets; no host
socket pathname is mounted. The sandbox cannot invoke the sender or approval API.

The spawn itself has `env: {}`, and bubblewrap additionally uses `--clearenv`
then sets only PATH=/usr/bin:/bin, HOME=/workspace, and LANG=C.UTF-8. The shell
may add PWD. No inherited credentials, proxy settings, or model keys reach it.
Timeout is `RAHAT_PI_WORKSPACE_SHELL_TIMEOUT_MS` (positive integer, default 30,000).
Timeout/cancellation sends SIGKILL to the detached process group; killing
bubblewrap's PID-namespace init also kills descendants that changed sessions.
Parent death kills the sandbox through `--die-with-parent`. Stdout and stderr are
combined, drained, and retain only their first 65,536 bytes plus an explicit
`[output truncated]` marker. Results include output, truncated, timedOut, exitCode,
and signal. Nonzero exits, signals, and timeouts are tool errors. Missing bwrap
raises a clear refusal; sandbox setup failure returns bwrap's error, with no fallback.
The executable path is injectable only in the Workspace constructor for tests,
never through model arguments or env configuration.

Pi 1.4.0 `replay: "unsafe"` records shell intent before dispatch. After a crash,
Pi emits an error result saying the tool was interrupted and may have partially
run; it never invokes that command again. This is uncertainty, not rollback or
success. A model could explicitly request a new command, so the tool description
also prohibits automatic retries. Read/list use `replay: "safe"`. Write also uses
safe replay: it replaces the entire file with the same durable arguments, so a
crash during replacement is repaired by repeating that content. It is not append.

Workspace deviations/gaps: custom tools use `defineTool` rather than installing Pi's
host `CodingTools`/`NodeExecutionEnv`, whose cwd alone is not isolation. No new
npm dependency, model, or provider was added. The mounts assume a merged-usr
Linux layout; unsupported bubblewrap/kernel setups fail closed. The owner must not
place secrets in the workspace or race filesystem tools by externally changing
parents/mounts: realpath checks are not a race-proof openat2 jail against a hostile
host user. Main tools are sequential, and sandbox descendants die before a shell
call returns. File writes are whole-content replacement, not atomic rename or
power-loss-durable storage. Shell writes have no disk, memory, or process quotas;
the namespace sandbox shares the host kernel. No live model calls were run.

## Cost tracking, stats, and evals

`src/policy/limits.ts::reserveModelRequest` commits a `rahat.costs` request alongside
the existing daily reservation, before dispatch. `src/harness/costs.ts` defines
that separate session document; existing App data formats are unchanged. Each
attempt has a unique ID, provider/model, role (`main`, `subagent`, `compaction`),
local reservation day (`RAHAT_PI_TIMEZONE`), reserved USD, and nullable reported usage.
`capModelOutput` saves the final pi-ai message's Usage before forwarding its done
or error event. `budgetCompactionModels` saves returned summary usage before the
existing `compaction_summary_ready` crash hook. Error/aborted responses without
reported tokens remain unknown; zero-cost successful faux replies are known.
No cost is inferred from assistant prose or from the reservation.

Usage includes input/output/cache tokens and `usage.cost`, as supplied by pi-ai.
These are reported/calculated model costs, not an OpenRouter invoice receipt.
Pi 1.4.0 `harness.usage(context)` aggregates every conversation's `UsageDoc`,
including summary attempts and tool usage. Stats exposes that ledger as `piUsage`.
Faux reports real token estimates but USD 0; tests inject explicit USD values at
its response boundary to verify nonzero accounting without paid calls.

The initial cost document snapshots Pi model totals from before cost tracking existed. `readStats` adds
those legacy costs (and any excess Pi usage not in the journal) as unattributed
actual spend; it never fabricates their day or role. Today's actual is the known
journal spend reserved on today's local date. Total actual combines journal and
unattributed spend. Unknown attempts remain counted, with reservations retained.
A SIGKILL before usage is saved leaves unknown cost. After usage is saved but
before Pi commits its response, the journal can exceed Pi's ledger; the saved
charge remains. Recovery reserves a new attempt, since a replay can cost again.
Reading stats never dispatches a model or changes accounting. Reported usage itself is the durable settlement record.

`App.stats` combines `readStats` with existing subagent status resolution.
`stats` works standalone and over the owner socket; `--json` returns structured
values, default output shows USD to six decimals. The web page/state/snapshot
include the same stats. Today/total and each role/model expose `actualUsd`,
`openReservedUsd`, `unknownReservedUsd`, and `countedUsd`. Text output names all four.
`reservedUsd` remains the gross historical reservation amount for compatibility;
it is not the amount counted against caps. `unknownRequests` excludes currently-open
requests. Legacy reservations without request records have no invented role/model;
they appear in aggregate unknown USD, without an invented request count.
Older unattributed actual models are separate. Tool failures count retained
`isError` tool-result messages by name across conversations. Actions include all
seven statuses, including rejected. Task scans paginate, including terminal tasks:
`crashed` means records currently carrying a nonzero Pi restart count; `parked`
means inspection reports `restart_limit`, excluding ordinary waits/sleeps;
`aborted` and `faulted` count retained outcomes. Pi resets restart counts after
progress, so crashed is not a lifetime process-crash audit. Subagent counts use
owner-task status, including existing tool-error semantics. Stats reads several
snapshots; active work can advance between them. History scans and the request
document grow with usage; this is intended for the existing small single-owner store.

Daily and optional lifetime USD caps admit a request only when reported actual
spend + open reservations + unknown-cost reservations + its worst-case reservation
fit the cap. Actual overages count in full, for both daily and lifetime caps.
The request journal and admission checks share one Pi commit. Reported usage is
saved before returning the response to Pi; `usage ??=` makes settlement idempotent.
There is no separate subtraction that could be lost or applied twice. A successful
zero-cost faux response settles to zero. Errors/aborts without usage become unknown;
startup marks all unreported pre-restart requests unknown before scheduling resumes.
If marking a finished request fails, the error is logged and the reply still ends:
the request stays open with its full reservation counted until restart marks it.
A replay reserves a new attempt while the interrupted attempt remains counted.

Migration is additive within the existing cost document. On first open, sum the
journal's original reservations per day and subtract them from old `dailyReservations`.
The nonnegative residual is saved once as `legacyDailyReservations`, retained as
unknown on its original date (and in lifetime spend). Journal entries with usage
immediately count their actuals, even if saved before a crash; entries without usage
remain fully reserved. Pre-journal Pi actuals are saved as `legacyActualUsd` and count
only toward the lifetime cap, since their dates are unknown. These known actuals
cannot be associated with unmatched legacy reservations, so both conservatively count.
Migration and repeated opens cannot release or duplicate the residual. The original
`dailyReservations` ledger continues recording gross reservations for compatibility;
enforcement uses the journal and migrated residual instead. Reported/catalog costs
are not invoice receipts and cannot guarantee an invoice-level cap if pricing changes.

`npm run eval` calls `scripts/eval.ts` / `src/evals/runner.ts`, separately from
Vitest. Fifteen scripted scenarios run actual App/Pi tools with faux: memory
remember/recall across restart/forget, Calendar, routines, proposal-only,
approval hash/edit binding, injected direct-send/approval attempts, child reads
and write denial, workspace read/write/traversal, compaction facts, and stats.
Each invocation creates a fresh private `data/evals/offline-*` store and a sibling
0600 JSON report with results, pass/fail counts, and stats. Failures are collected;
any failure exits 1. Scripted outcomes are deterministic; directory IDs and Pi
runtime timestamps are not golden data. Faux summaries echo source, so offline
evals allow 256,000 reserved tokens/run and USD 50 reservations (still USD 0 actual),
with 512 output tokens; application defaults remain unchanged.

Explicit `--live` or `RAHAT_PI_LIVE_EVAL=1` selects only four natural-language
scenarios: remember, recall after restart, fixture Calendar, proposal-only.
The inherited OPENROUTER_API_KEY is required before opening a store. Each run
uses a fresh `data/evals/live-*` directory and fixes both daily and lifetime
reservation caps to USD 0.25, including across restart/day rollover. Inherited cap
settings cannot expand it. Live output is capped at 8000 tokens/request (thinking
counts toward it) and 300000 reserved tokens per message; offline evals keep 512.
All three live models default to `anthropic/claude-haiku-5.5`, overridable with
RAHAT_PI_MODEL / RAHAT_PI_SUBAGENT_MODEL / RAHAT_PI_SUMMARY_MODEL. The USD 0.25 caps
still bound the whole run.
No approval/executor tick or real outbound connector is used. Run stats/report
retain any failures at the cap rather than retrying around it.

Cost tracking originally retained all reservations; the settled-cost contract above
supersedes that rule. A separate journal is needed because Pi's aggregate ledger has no dates or
request roles, and summary usage can be lost before Pi commits it. Historic day/
role attribution and lifetime process-crash history cannot be reconstructed.
Faux policy evals prove code boundaries, not natural-language injection resistance.
The live runner path and caps are covered with faux substitutions; real model
behavior/billing were not exercised. No dependency, provider, or model was added.

## Stopped tasks and retry

Pi 1.4 parks a task that a crash cut off 5 times in a row (`settings.restartLimit`,
left at its default): it stays live but never runs again until `Harness.retryTask()`.
A parked tool or generation keeps its chat turn busy, so chat appears stuck; a parked
routine silently stops. `src/harness/health.ts` lists every task that
`harness.inspect()` reports as `blocked`, with a plain label (`Chat answer`, `Helper
answer`, `Chat summary`, `Tool call (<name>)`, found through the live view's call id,
or `Routine "<name>"`), its reason, restart count, and `canRetry` (only `restart_limit`;
`missing_task`, `task_too_old`, and `migration_failed` need a code fix).

`npm run cli -- health` prints them; `npm run cli -- retry <taskId>` reruns a parked
one. Unlike Pi's `retryTask`, which quietly ignores a task that is not parked, the
owner command refuses an unknown or non-retryable id with a reason. Without the
running service the CLI only clears the park; the task runs at the next start. The
web state carries `stoppedTasks`, `POST /api/tasks/retry` (`{taskId}`, behind sign-in,
then an explicit state refresh because a task record changes no watched document)
retries one, and the app shows a red banner with a Retry button on every screen size.
A SIGKILL test crashes `memory_write` five times, sees it listed, retries it, and finds
the memory stored once.

## Notifications

Brain side only so far; the app's service worker and toggle are the next step.

**Records.** `src/harness/notifications.ts` keeps `NotificationsDoc` (session doc):
records `{id, seq, title, body, createdAt}`, push subscriptions, and `nextSeq`. Text is a
fixed template written by the brain; the model never writes it or chooses who gets it, so
a notification is not an external write that needs approval. Text is minimal: no recipient
or message body. `addNotification(transaction, …)` runs inside the commit that records the
event, so a notification exists exactly when its event does. Ids come from the event, so
recording it twice (a replayed tool, a retried check) keeps one record. The newest 100 stay.

| Event | Recorded in |
| --- | --- |
| Approval waiting | `propose_send_message` commit |
| Approval expires within 2 hours | service check every 30 s (`checkNotificationTriggersIfDue`) |
| Send failed (approval expired before dispatch) | executor claim commit |
| Send result unknown | executor `reconcile`, only once no receipt is found, so a crash right after a real send raises no false alarm |
| Routine finished / failed | `BriefingTask` result and abort commits (name only, no reply text) |
| Task stopped after crashes | service check every 30 s; `notifiedStoppedTaskIds` drops a task once it runs again, because Pi resets the restart count on retry |
| Test | owner command `notify-test` |

The `tick` owner command runs both checks and delivery at once.

**Delivery.** Pushes carry no content (`src/harness/push.ts`): an empty, VAPID-signed POST
(RFC 8292, ES256 via `node:crypto`, `TTL` 24 h, `Urgency: high`) wakes the browser's service
worker, which then asks this server for the text. Push services (Google, Mozilla) never see
what happened, and no encryption library is needed. The key pair is made once in
`data/push-keys.json` (0600) and backed up, because subscriptions are bound to it.
`Notifier.tick()` in the service loop pushes each subscription whose `pushedSeq` is behind
the newest record. 2xx advances it; 404/410 deletes the subscription; anything else or a
network error backs off 10 s doubling to 1 h. Delivery is at least once: a crash after a push
but before saving it pushes again (tested at crash point `push_sent`). A repeated ping is
harmless; a lost one could let an approval expire unseen. The stop flag pauses delivery.

**Endpoints** (behind sign-in): `GET /api/push/key`; `POST /api/push/subscribe` and
`/unsubscribe` (`{endpoint}`, https only, no credentials); `POST /api/notifications/pending`
(`{endpoint}`, records after the browser's `shownSeq`, oldest first, at most 20; 409 for an
unknown endpoint); `POST /api/notifications/shown` (`{endpoint, seq}`). A new subscription
starts at the newest record, so old ones are not replayed.

**Limits.** Push reaches only a browser that is running on a machine where the app is open
at `127.0.0.1`; phones need remote HTTPS access first. The real push path through a push
service is not yet checked live.

## Backups

`src/harness/backup.ts` writes `<dataDir>/backups/<ISO time>/` (folder 0700): `pi.sqlite`
and `fake-provider.sqlite` through `VACUUM INTO` from a read-only connection, which
copies one consistent snapshot including WAL commits while the service runs, each
checked with `PRAGMA integrity_check`; then `workspace/`, `web-token`, and `push-keys.json` as files. It
writes into `<name>.partial` and renames when complete; a later backup deletes any
leftover partial (one process owns the data folder). The newest 14 are kept.

The service loop calls `App.backupIfDue()`: at most once an hour it checks the newest
backup's time and saves one when there is none or it is 24 hours old, so backups follow
restarts and sleep without a fixed clock time. A failure is logged and retried at the
next hourly check. `npm run cli -- backup` (owner command `backup`) saves one now.
Backups use the wall clock, not `RAHAT_PI_NOW`. Restore is manual (README): stop the
service and copy a backup's contents into an empty data folder; tests restore a backup
into a fresh folder and find the memory and workspace file. Backups do not leave the
agent's disk; copying them elsewhere is the owner's job.

## Limits and stop

`src/policy/` owns the tool allowlist and checks tool-call counts in Pi ToolTask's
blocking beforeTool hook. A run's counters are keyed by its first submission ID,
so they survive restarts and span every tool/model turn. Safe replays reuse call IDs.

Generation hooks in Pi 1.4.0 report thrown errors and continue. Therefore the actual
Models.streamSimple wrapper awaits `reserveModelRequest` before provider dispatch.
Pi's persisted `ProviderDoc.sessionId` identifies the requesting conversation;
parent and child budgets are keyed by their own globally unique submission IDs,
and all reserve against the shared `rahat.costs` request journal and migrated legacy amounts. Unknown
provider sessions fail closed. Lookup currently scans retained child records.
It also forwards `maxTokens` (absent from Pi 1.4.0's curated stream settings).
Token reservations include serialized input/schema UTF-8 bytes, 4096 framing tokens,
and maximum output tokens. Daily USD reservations use pinned catalog prices and
maximum output. Reported usage settles reservations to actual cost; attempts with
no reported usage keep their full reservation, so unknown cost stays conservative. Pi's usage documents separately retain reported actual
usage/cost; reservations are not a billing receipt. Catalog prices can change: use
an OpenRouter account spending limit for an independent billing cap.

Defaults: 300,000 reserved tokens/run, 8,000 output tokens/request (thinking included), 120 seconds/run,
20 tool calls/run, USD 5/day (local day in `RAHAT_PI_TIMEZONE`). These are configurable with the env
variables in .env.example. Automatic main-chat compaction is enabled; provider retries and deferred
requests remain disabled. A 50ms watchdog aborts expired runs, including after restart;
model requests also have a timeout. Stop writes a persistent local flag, checked at
model dispatch/executor boundaries and by the watchdog. The service aborts the root
with `{background: true}`, cancels durable work, and closes its store. Unix signals
SIGINT/SIGTERM also stop the service. `stop` acknowledges the request, not completion.
An already-entered synchronous fake dispatch may complete before cancellation.

## Connectors

`src/extensions/calendar.ts` defines CalendarAdapter. FixtureCalendar is the default
and filters events by overlap in a validated ISO interval. All events carry source.
GoogleCalendar is an intentional stub that throws “OAuth is not configured”. Real
OAuth consent, credential storage, scopes, and API integration remain future work.

## Explicit deviations and gaps from the original design

- A single session document with keyed records replaces separate Pi document families;
  there are no separate Space/Connector records. The only space is implicitly personal.
- A daily HH:mm schedule replaces generic cron; only fixed-offset timezones (no DST) are supported.
  Deleted routines retain tombstones/audit history. Only the owner can resume a paused routine.
- FTS5 is an in-memory rebuildable index; Pi SQLite persists the facts themselves.
- CLI/service communication uses a local Unix socket and OS owner access; optional web uses a local token.
  Hosts without systemd use the supervisor script; see Deployment.
- Calendar OAuth remains a documented stub, as planned. Sends are local fixtures.
- Budgets reserve conservative estimates rather than enforcing invoice-level USD totals;
  unresolved request charges are not assumed free. Compaction uses the same guards;
  a single large input or a blocked summary can still hit a cap/context limit.
  Full retained history remains in Pi storage.
- No goals profile, channels beyond CLI/local web, real sender, or payload
  attachments are implemented yet. Backups stay on the agent's disk.
- Pi and node:sqlite are experimental. This is one local process, not a distributed service.

Subagent deviations: foreground tool-result delivery was chosen over example 23's
background reporters. `vitest.config.ts` now includes only `tests/**/*.test.ts`:
the downloaded community reference uses Node's test runner and is not our suite.
The faux router ignores trailing system messages when finding the current input,
matching the official example and allowing child configuration changes in tests.
Live subagent calls were not run; Calendar remains a fixture. Timeout cancellation
is cooperative and observed by the watchdog, with scheduling jitter, not a process
CPU sandbox. Saved histories and model session lookups grow with child count.

## Deployment

`deploy/rahat-pi.service` is a systemd user unit for hosts that boot with systemd.
It runs one process, `node --import tsx src/cli.ts web`, from `~/rahat-pi` (edit the
paths for another location), loads `.env` through `EnvironmentFile=-` (optional),
and uses `Restart=on-failure`, not `always`: `rahat-pi stop` exits 0 on purpose, and
an automatic restart would clear the stop flag and defeat the kill switch.
Start at boot needs `systemctl --user enable` plus `loginctl enable-linger`.

Hosts without systemd (for example containers whose PID 1 is tini) use
`deploy/supervise.sh`. It runs the Node found on PATH, or `RAHAT_PI_NODE`. `start` runs a detached (`setsid nohup`)
restart loop; non-zero exit or a signal (e.g. kill -9, exit 137) restarts after
2 s; exit 0 ends supervision. `stop` sends SIGTERM to the supervisor, which forwards
it to the service. Files under `data/`: `supervisor.pid`, `service.pid`,
`service.log` (log appends; no rotation). Pid/log files always use `data/`, even when
`RAHAT_PI_DATA_DIR` points the service elsewhere.

Limits: the fallback does not start on host reboot; something must run
`bash deploy/supervise.sh start` again. The key comes from the starting environment or
from `.env` (dotenv, read from the repo directory); no key is written by the scripts.

## Web research

`src/extensions/web-research.ts` registers `web_fetch({url})` through Pi 1.4.0
`defineTool`, with `replay: "safe"`. App installs it alongside the personal tools;
`childToolNames` and the ownership hook admit it for read-only subagents too.
Existing CLI chat, service and web UI use the same registration. No new command,
dependency, provider, model, document format or crash-point name was required.

The tool performs a credential-free GET using Node's built-in fetch. Only HTTP(S)
and successful text/html or text/plain responses are accepted. Each call has one
15-second deadline covering DNS, redirects, headers and body; owner/run cancellation
also aborts it. Five redirects are allowed and every destination is checked anew.
Downloads fail above 1 MiB (declared length and streaming bytes); readable output
keeps its first 20,000 UTF-16 code units with `truncated: true` when necessary.
Compressed responses are refused, with Accept-Encoding: identity, to avoid inflation.
Bodies are always drained or cancelled and connections are not pooled.

SSRF checks reject credentials, localhost/subdomains, .local, trailing-dot names,
and any non-public resolved address. IPv4 private, loopback, link-local, shared,
reserved, multicast and documentation ranges are blocked. IPv6 must be global
unicast, excluding special/documentation and 6to4 ranges; IPv4-mapped and translation
addresses are refused. All DNS answers must pass, then the first is pinned to the
actual socket. A small fetch dispatcher uses built-in http/https request with a
fixed lookup callback and family, preserving the original Host, TLS SNI and normal
certificate validation. It performs no second DNS lookup, proxying, cookie storage,
or credential/header forwarding. The loopback web UI is blocked on every port,
including configured aliases resolving to local addresses.

The constructor alone accepts an exact literal-127.0.0.1 test origin and injectable
DNS/timeout; neither model arguments, env nor CLI expose an allowance. App.open can
receive this WebResearch instance for integration tests. Tests use ephemeral local
HTTP servers; the public-DNS pin test stops at a mocked socket boundary.

HTML extraction removes comments, script/style/noscript blocks and tags, decodes
common named/numeric entities, and collapses whitespace. Plain text remains literal.
Results include sourceUrl, finalUrl, contentType, downloadedBytes, truncated,
`trust: data`, and an explicit UNTRUSTED WEB CONTENT warning alongside content.
Fetching never calls memory or proposal tools. Explicit memory_write still stores
web-sourced content only as data, never a profile/system section. A model-generated
send remains a proposal; only owner approval lets the fake executor create outbox.
Pi persists the result normally. A crash before completion may repeat the GET and
observe changed content; it creates one durable result and no local side effects.

Deviations/gaps: optional web_search is omitted; no stable keyless search endpoint
is integrated. The HTML stripper is deliberately a best-effort regex extractor,
not a browser/parser, and decoding assumes UTF-8. No JavaScript, authenticated
pages, PDFs, compression, citations engine or search provider is supported. GET
requests disclose the server IP and URL/query to the remote host and can have
remote effects on badly designed sites. Guarding IP addresses cannot identify a
public service that itself proxies private resources. Model prompt-injection
resistance is not proven: hostile text remains in ordinary conversation history
and may influence replies or summaries, local memory facts or proposals. Data trust
and approval enforcement prevent automatic instruction promotion and unapproved
sends, not every misleading model decision. Live HTTPS/model behavior was not run.
