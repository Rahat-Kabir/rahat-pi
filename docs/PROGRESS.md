# Progress

What changed, step by step, newest first. Each entry says what was built and how it was verified.

## M2 roadmap: the Rahat-PI app

- [x] API contract (`src/web/api-types.ts`) and safe serving of the built app at `/app/`
- [x] App shell (React + Vite + Tailwind), installable; chat and approvals
- [ ] Notifications when an approval is needed or a routine finishes
- [x] Memories: owner CLI commands, then endpoint and screen
- [ ] Routines: owner CLI commands first, then endpoints and screens
- [ ] Activity: tool calls, subagents, costs
- [ ] Make the app the default UI and remove the old page

### Memories screen (2026-10-24)
Owner commands `memories` (newest first) and `forget <id>`; memories ride the live state, and `POST /api/memories/forget` forgets one behind sign-in.
The app has a Chat | Memories switch; each memory shows its source and save time, and Forget asks for confirmation first. Past chat that mentions a forgotten fact is not rewritten.
Verified: CLI and web tests (signed-out 401, unknown id 409, live update), full offline suite, app tests and build, and the CLI against the running service.

### Approvals you can't miss on a phone (2026-10-24)
On narrow screens a pinned banner ("2 approvals waiting · Review ↓") scrolls to the approvals, and the panel moves above the chat while anything waits.
Desktop layout is unchanged. Verified: new app logic test (waiting count and label) and app build; a visual check at phone width is pending.

### Readable tool calls in the app (2026-10-24)
Tool calls show as one plain line each (for example `Searched memory for "tea"`), with the raw arguments folded under it; running tools say what they are doing.
Thinking is folded under "Thinking" instead of showing as raw JSON with its signature. App-only change; the brain is untouched.
Verified: 5 new app logic tests and app build; a visual check in an offline preview is pending.

### Sign in once; every read needs it (2026-10-24)
The web token now survives restarts; the app signs in once and gets a 400-day HttpOnly, SameSite=Strict cookie, so reloads and the installed app stay signed in.
Every data route (`/`, `/api/state`, `/api/events`, POSTs) now needs the cookie or `X-Rahat-Token`; before, reads were open to anyone who could reach the port.
Verified: new sign-in, restart, and signed-out tests; full offline suite with SIGKILL tests; app tests and build. Still open: remote access (Tailscale, `Secure` cookie).

### Approval wording and private data folder (2026-10-24)
The system prompt and `propose_send_message` now say approval happens in the app or the owner CLI.
`App.open` and `deploy/supervise.sh` set `data/` to 0700 even when it already existed; before, a folder created by the script or a test stayed readable by other users.
Verified: new storage test, full offline suite, typecheck, and a sandboxed supervise.sh start for new and existing folders.

### App shell with chat and approvals (2026-10-24)
`ui/` holds a React app served at `/app/`, typed against a self-contained API contract that a type test keeps in line with the brain.
Static serving refuses traversal, symlink escapes, and unknown types; the old page at `/` is unchanged.
Verified: 4 new server tests, 12 app logic tests, typecheck, app build, and an offline browser check (chat, approve, escaped `<script>`, phone width, dark mode).

### Failed-turn context and settled spending caps (2026-10-24)
Terminal unanswered turns now leave model context through durable omission edits; original history and crash resume remain intact.
USD caps count reported actuals plus open/unknown reservations; stats expose each amount and migration retains untraceable legacy reservations.
Verified offline: typecheck, full test suite including SIGKILL recovery, and all 15 evals; no live calls or dependencies added.
Review fixes: a failed cost-settlement save is logged instead of hanging the reply stream, and the
failed-turn cleanup remembers handled inputs so it stops re-reading full history on every request.
The "deadline" omission test fails on plain Windows (timing) with or without these fixes; it passes on Linux.

### Claude 5.5 model defaults (2026-10-24)
Defaults are now `anthropic/claude-sonnet-5.5` (main) and `anthropic/claude-haiku-5.5` (subagents
and summaries), both tested live in chat; code, `.env.example`, README, and tests updated.
The opt-in live eval now defaults to Haiku 5.5 for all three roles with 8000 output / 300000 run
tokens (USD 0.25 cap unchanged). That live eval has not been re-run with the new models.
Code defaults now match `.env.example`: output 8000, run tokens 300000, compaction at 40000.
Tests pin the old smaller limits in `tests/helpers.ts`. The USD 5/day default stays; the later spending-cap fix above replaces permanent
pessimistic reservations with settled actuals plus open/unknown reservations.

### Linux tests from Windows (2026-10-24)
`npm run test:linux` copies the current checkout (no `.env`, `data/`, `.git`) to `~/rahat-pi-check`
in WSL and runs typecheck plus the full suite with Node 22; `npm ci` reruns only when the lockfile
changes. Non-Windows systems get a clear "run npm test" message instead.

### Full Linux verification in WSL (2026-10-24)
All of today's changes (watchdog, readability, synchronous=FULL, owner/timezone settings,
demo, Node check) verified on Linux: Ubuntu WSL, Node 22.23.4, project in the Linux home folder.
Typecheck passes and all 107 tests pass, including every SIGKILL crash, sandbox, and service test.

### Easy start for new users (2026-10-24)
`npm run demo` walks through memory, restart, approvals, and send-once offline on any OS.
Every npm entry point checks Node 22.19+ first (`scripts/check-node.mjs`) and hides the
node:sqlite ExperimentalWarning. README quick start now works for Windows PowerShell too.
Verified: demo and CLI on Windows from a fresh clone; old-Node message on Node 18 (WSL).

### Configurable owner name and timezone (2026-10-24)
`RAHAT_PI_OWNER_NAME` (default `Owner`) feeds the prompt and approvals; `RAHAT_PI_TIMEZONE`
(default `UTC`) drives routines, daily caps, and stats. DST zones are refused at startup.
Existing routines keep their stored timezone. Tests pin `Etc/GMT-6`, so expectations are unchanged.
Verified on Windows: typecheck and affected tests (new timezone tests pass); Linux crash run still open.

### .env.example defaults from live testing (2026-10-24)
Compact at 40000, run tokens 300000, output tokens 8000. Live Sonnet/Haiku 5.5 testing hit all
three old limits: thinking used up 1024 output tokens (incomplete summaries), two web pages
exceeded 64000 reserved run tokens. Resolves the open compaction-threshold concern. Code defaults unchanged.

### Power-loss durability for pi.sqlite (2026-10-24)
Chord opened Pi's database with synchronous=NORMAL (could lose newest commits on power loss).
`src/harness/storage.ts` now opens it with synchronous=FULL, matching the fake outbox.
Verified on Windows: typecheck and the new storage tests; real power loss not simulated.

### Review cleanup: readability, watchdog, docs (2026-10-24)
Watchdog now remembers finished tasks instead of re-reading every subagent and re-aborting
stopped routines 20×/s. Shared `runDeadlineReached`/`toolResult`; faux model in its own file;
long lines wrapped (except page.ts HTML). AGENTS.md gained Key Decisions, landmines, Self-Update.
Verified on Windows only: typecheck, 71/101 tests (same 30 platform failures as before). Linux run still open.

### Live checks and supervisor switch (2026-10-24)
Live eval (gpt-5.4-mini, 4 tasks) passed at $0.0058 reported cost. Live web_fetch of
https://example.com/ failed closed: the test host's DNS returned fake IP 198.18.0.1 for every
host, which the SSRF guard blocks as a reserved range. The guard was
left strict on purpose; real fetches need a host with real DNS. Supervisor and systemd
unit now run `web` so the UI is up at 127.0.0.1:8787.
Open concern: RAHAT_PI_COMPACT_AT_TOKENS=8000 compacts after very few turns; consider
raising it together with RAHAT_PI_MAX_RUN_TOKENS.

### Web research (2026-10-24)
Added replay-safe web_fetch for main/children, DNS-pinned SSRF checks, bounded HTML/plain text and untrusted provenance.
Injection checks enforce data-only memory and approval-only sends; SIGKILL recovery retains one result.
Verified: 100 offline tests (18 SIGKILL cases) and typecheck; no dependencies/live calls; optional search omitted.

### Costs and evals (2026-10-24)
Added durable reported-usage records, CLI/web stats, and 15 deterministic offline evals with JSON reports.
Opt-in four-task live eval uses a fresh store and USD 0.25 lifetime reservations; unknown charges stay reserved.
Verified: 89 offline tests (17 SIGKILL cases), all 15 evals, and typecheck; no dependencies or live calls.

### Sandboxed workspace (2026-10-24)
Added main-only workspace list/read/write and bubblewrap shell; path jail, byte/time caps, no network/secrets.
Unsafe shell replay reports interrupted effects without rerunning; approval/executor remains the only send path.
Verified: 73 offline tests (14 SIGKILL cases), including 13 new cases, and typecheck; no dependencies/live calls.

### Local web UI (2026-10-24)
Added `web`: loopback HTTP/SSE, Pi live state, busy-run inputs, exact-hash approvals, and subagents.
Host/token guards and fresh durable reconnects; `web:snapshot` saves static HTML; no dependencies/live calls.
Verified: 60 offline tests (13 SIGKILL cases), typecheck, and a saved `data/web-snapshot.html`.

### Compaction (2026-10-24)
Added automatic/manual main-chat summaries through the cheap model, shared reservations, and durable Pi placement.
Memory/profile/history survive; fixed first-request token persistence; two new SIGKILL boundaries recover consistently.
Verified: 51 offline tests (11 crash cases) and typecheck; no dependencies or live calls added.

### Subagents (2026-10-24)
Added foreground child conversations, read-only/depth/concurrency guards, shared daily reservations, and `subagents` CLI.
Child tool/deadline caps and exactly-once parent results survive restart; no dependencies added.
Verified: 35 offline tests, including 9 SIGKILL cases, and typecheck; live child calls remain untested.

### Live check and service supervision (2026-10-24)
Live Sonnet 4.6 run: memory write, recall after restart, proposal, approval, one outbox row.
Added `deploy/rahat-pi.service` (systemd hosts) and the `deploy/supervise.sh` restart
loop (hosts without systemd). Verified kill -9 restart with state intact; stop does not restart.

### Readability cleanup (2026-10-24)
Expanded compact blocks, clarified local names, and separated App commands and socket handling.
Preserved test names/assertions, data contracts, crash points, and operation order.
Verified: 22 offline tests, all five crash demos, and TypeScript checks; live calls remain untested.

### Complete chat output (2026-10-24)
Chat prints the committed final answer once; tool notifications remain live.
Two chunked faux-provider regressions reproduce the former fragment loss and now
pass. Verified: 22 offline tests, all five crash demos, and TypeScript checks.

### Local durable agent (2026-10-24)
Pi Durable/SQLite now powers chat, sourced memory, durable daily briefings, fixture
Calendar, and approval-gated fake sends. All five restart demos pass; 20 offline
tests and TypeScript checks pass. Live chat/OAuth/sends were not attempted.

### Planning (2026-10-24)
Design spec, AGENTS.md, and docs scaffold written. No code yet.
