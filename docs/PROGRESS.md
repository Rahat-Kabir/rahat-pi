# Progress

## Roadmap
- [x] M1. Terminal chat, memory, one routine, Calendar fixture read, approvals with a fake sender, 5 crash tests
- [ ] M2. Gmail read, second channel, one real outbound connector
- [ ] M3. Drive, GitHub, two bounded subagents, backup/restore
- [x] M3 slice 1. Two bounded read-only subagents as durable child conversations
- [x] Slice 2. Budgeted main-chat compaction, automatic threshold and owner CLI
- [x] Slice 3. Local web UI with live chat, steer/follow-up, hash-bound approvals, reconnects
- [x] Slice 4. Sandboxed workspace file/shell tools with no network or secrets and unsafe shell replay
- [x] Slice 5. Reported usage/cost stats, reservations, and offline/opt-in capped live evals
- [x] Slice 6. Read-only web fetch with DNS-pinned SSRF checks, bounded text, and data trust
- [ ] M4 remainder. Isolated computer use, AWS option

## M1 checklist
- [x] Pi Durable 1.4.0 SQLite conversation; terminal chat with live tool display and one-shot mode
- [x] Memory write/search/forget with source, FTS5, and curated profile
- [x] Daily durable timer in a fixed-offset timezone, unique occurrence IDs, skip/catchUpOnce
- [x] Calendar adapter and fixture; clear OAuth-not-configured stub
- [x] Hash-bound expiring approvals, payload edit invalidation, owner CLI
- [x] Fake executor/outbox receipts, crash uncertainty, lookup-only reconciliation
- [x] Tool allowlist, run/token/tool/deadline and daily reservation caps
- [x] Long-running service, owner socket, stop flag and cancellation
- [x] Five SIGKILL/restart demos, offline unit/integration/service tests, typecheck

## Log
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

### Web research — slice 6 (2026-10-24)
Added replay-safe web_fetch for main/children, DNS-pinned SSRF checks, bounded HTML/plain text and untrusted provenance.
Injection checks enforce data-only memory and approval-only sends; SIGKILL recovery retains one result.
Verified: 100 offline tests (18 SIGKILL cases) and typecheck; no dependencies/live calls; optional search omitted.

### Costs and evals — slice 5 (2026-10-24)
Added durable reported-usage records, CLI/web stats, and 15 deterministic offline evals with JSON reports.
Opt-in four-task live eval uses a fresh store and USD 0.25 lifetime reservations; unknown charges stay reserved.
Verified: 89 offline tests (17 SIGKILL cases), all 15 evals, and typecheck; no dependencies or live calls.

### Sandboxed workspace — slice 4 (2026-10-24)
Added main-only workspace list/read/write and bubblewrap shell; path jail, byte/time caps, no network/secrets.
Unsafe shell replay reports interrupted effects without rerunning; approval/executor remains the only send path.
Verified: 73 offline tests (14 SIGKILL cases), including 13 new cases, and typecheck; no dependencies/live calls.

### Local web UI — slice 3 (2026-10-24)
Added `web`: loopback HTTP/SSE, Pi live state, busy-run inputs, exact-hash approvals, and subagents.
Host/token guards and fresh durable reconnects; `web:snapshot` saves static HTML; no dependencies/live calls.
Verified: 60 offline tests (13 SIGKILL cases), typecheck, and a saved `data/web-snapshot.html`.

### Compaction — slice 2 (2026-10-24)
Added automatic/manual main-chat summaries through the cheap model, shared reservations, and durable Pi placement.
Memory/profile/history survive; fixed first-request token persistence; two new SIGKILL boundaries recover consistently.
Verified: 51 offline tests (11 crash cases) and typecheck; no dependencies or live calls added.

### Subagents — slice 1 (2026-10-24)
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

### M1 fix — Complete chat output (2026-10-24)
Chat prints the committed final answer once; tool notifications remain live.
Two chunked faux-provider regressions reproduce the former fragment loss and now
pass. Verified: 22 offline tests, all five crash demos, and TypeScript checks.

### M1 — Local durable agent (2026-10-24)
Pi Durable/SQLite now powers chat, sourced memory, durable daily briefings, fixture
Calendar, and approval-gated fake sends. All five restart demos pass; 20 offline
tests and TypeScript checks pass. Live chat/OAuth/sends were not attempted.

### 0 — Planning (2026-10-24)
Design spec, AGENTS.md, and docs scaffold written. No code yet.
