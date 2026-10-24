# Rahat-PI

A self-hosted personal AI agent that is safe to leave running.

It chats, remembers facts, runs daily routines, reads the web, and delegates
small tasks to helper agents. It never sends anything to the outside world
until you approve the exact message, and it picks up where it left off after
a crash or restart.

Built in TypeScript on [Pi Durable](https://earendil.com/posts/pi-durable/),
with models through [OpenRouter](https://openrouter.ai/).

> **Status: experimental personal project.** The core agent works. Calendar
> reads and outgoing messages are still **fixtures**: sends go to a local fake
> outbox, not to real people. Real connectors (Gmail, Calendar, a chat app) are
> planned. Pi Durable itself is experimental and its API may change.

## Why it is safe to leave running

- **Approval before any outside action.** The model can only *propose* a
  message. You approve the exact payload; approval is bound to a SHA-256 hash
  of it, expires, and is invalidated by any edit. An executor sends it once,
  with an idempotency key.
- **Unknown stays unknown.** If the process dies mid-send, the action is marked
  `unknown` and is never resent blindly. Reconcile only looks up a receipt.
- **Crash recovery.** Conversations, tasks, timers, and approvals are
  checkpointed in SQLite (`synchronous=FULL`). Real `SIGKILL` restart tests
  cover memory, routines, approvals, sends, subagents, compaction, and the shell.
- **Spending caps.** Every model request reserves its worst-case cost before it
  is sent: per-message token and tool-call limits, a wall-clock deadline, a
  daily USD cap, and an optional lifetime cap. Reservations are never refunded,
  because an interrupted request may still be billed.
- **Untrusted content stays data.** Web pages, memories, and calendar text are
  labeled as data, never instructions.
- **Sandboxed shell.** Workspace commands run in [bubblewrap](https://github.com/containers/bubblewrap)
  with no network, no secrets, and no access to the repo; without the sandbox,
  the shell refuses to run.
- **Guarded web fetch.** Public HTTP(S) only, DNS-pinned against SSRF, with
  size, time, and redirect limits.

## Features

| Area | What it does |
|---|---|
| Chat | Terminal chat (interactive or one-shot) and a local web UI with live streaming |
| Memory | Save, search (SQLite FTS5), and forget facts, each with its source |
| Routines | Daily briefings at a fixed time, with "skip" or "catch up once" for missed runs |
| Web | `web_fetch` reads one public page as untrusted text (no search engine) |
| Subagents | Up to two read-only helper agents on a cheaper model |
| Workspace | Read, write, and run shell commands in a sandboxed folder |
| Compaction | Long chats are summarized automatically; original history is kept |
| Stats | Reported spend vs. reserved budget, per model and role |

## Requirements

- **Node.js 22.19+** (uses the built-in `node:sqlite`; every npm command checks
  this first and tells you if your Node is too old)
- An [OpenRouter API key](https://openrouter.ai/keys) for live chat (the demo needs none)
- **Linux** for everything. **On Windows, use [WSL](https://learn.microsoft.com/windows/wsl/install)**
  (see below). macOS runs the demo, chat, background service, and web UI, but not
  the sandboxed shell (Linux-only bubblewrap). Plain Windows runs only the demo and chat.

| Feature | Linux / WSL | macOS | Plain Windows |
|---|---|---|---|
| Demo, terminal chat | ✅ | ✅ | ✅ |
| Background service, web UI (Unix socket) | ✅ | ✅ (not yet tested) | ❌ |
| Sandboxed shell (bubblewrap) | ✅ | ❌ | ❌ |
| Crash tests (`npm run test:crash`) | ✅ | not yet tested | ❌ |

### On Windows, use WSL

WSL runs a real Linux inside Windows, so every feature works with no code changes,
and the web UI still opens in your Windows browser at `http://127.0.0.1:8787`.

1. Install WSL with Ubuntu (`wsl --install` in an admin PowerShell), then open Ubuntu.
2. Install Node 22+ inside WSL, for example with [nvm](https://github.com/nvm-sh/nvm):
   `nvm install 22`.
3. For the sandboxed shell: `sudo apt install bubblewrap`.
4. Clone **inside the Linux home folder** (for example `~/rahat-pi`), not under
   `/mnt/c/...`: Unix sockets do not work on Windows drives mounted in WSL.

## Quick start

**1. Install** (same on every OS):

```bash
git clone <this-repo-url> rahat-pi
cd rahat-pi
npm ci --no-fund --no-audit
```

**2. Try the free demo** (no key, no network, about 10 seconds):

```bash
npm run demo
```

It walks through the core guarantees in a throwaway folder: remember a fact,
restart, recall it, propose a message, refuse an approval for different text,
send exactly once, and never send a duplicate.

**3. Chat with a real model.** Copy the settings file, then set `OPENROUTER_API_KEY`
(and optionally `RAHAT_PI_OWNER_NAME` and `RAHAT_PI_TIMEZONE`) in `.env`:

```bash
cp .env.example .env              # Linux / macOS
```

```powershell
Copy-Item .env.example .env       # Windows PowerShell
```

```bash
npm run cli -- chat
```

Type at the `You>` prompt; `/exit` quits. Live chat uses paid OpenRouter
requests, capped by `RAHAT_PI_DAILY_USD_CAP` (default USD 5 per day).

**Offline mode for your own experiments:** set `RAHAT_PI_OFFLINE=1` in `.env`.
The fake model echoes your text (`npm run cli -- chat --message "hello"` replies
`Offline reply: hello`) and runs a message of the form `/tool NAME JSON` as a scripted
tool call; see `scripts/demo.ts` for examples.

## Try the approval flow

```bash
npm run cli -- chat --message "Draft a message to Sam saying I'll be late"
npm run cli -- actions          # see the proposal: payload, hash, expiry
npm run cli -- approve <id>     # approve that exact payload
npm run cli -- tick             # run the executor once (or keep the service running)
npm run cli -- outbox           # the fake outbox shows one sent message
```

## Commands

| Command | Purpose |
|---|---|
| `npm run cli -- chat [-m "text"]` | Chat interactively, or send one message |
| `npm run cli -- run` | Long-running service: scheduler, executor, owner socket |
| `npm run cli -- web` | Same service plus the local web UI at `http://127.0.0.1:8787` |
| `npm run cli -- actions` | List proposals with payload, hash, expiry, and status |
| `npm run cli -- approve <id>` / `reject <id>` | Decide on a proposal |
| `npm run cli -- edit <id> --recipient R --body B` | Change a proposal (needs re-approval) |
| `npm run cli -- reconcile` | Look up receipts for `unknown` sends; never resends |
| `npm run cli -- subagents` | Helper agents, their status and answers |
| `npm run cli -- compact` | Summarize older chat history now |
| `npm run cli -- stats [--json]` | Spend and health statistics |
| `npm run cli -- stop` | Kill switch: stops the service and cancels running work |
| `npm run demo` | Free offline walkthrough of memory, approvals, and send-once |
| `npm run eval` | 15 free offline scenario checks with a JSON report |

## Web UI

`npm run cli -- web` serves a page on `127.0.0.1` only. Paste the token from
`data/web-token` to send messages or approve actions; the token changes on every
start. Approval buttons are bound to the payload hash you see. Do not expose
this port publicly: page reads are not token-protected, so other users on the
same machine can view them.

## Configuration

Settings live in `.env` (see `.env.example`):

| Variable | Default in `.env.example` | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | — | Required for live chat |
| `RAHAT_PI_OWNER_NAME` | `Your Name` | Who the agent works for (prompt and approvals); code default `Owner` |
| `RAHAT_PI_TIMEZONE` | `UTC` | IANA timezone for routines and daily caps; no daylight-saving zones |
| `RAHAT_PI_MODEL` | `anthropic/claude-sonnet-4.6` | Main model |
| `RAHAT_PI_SUBAGENT_MODEL` | `openai/gpt-5.4-mini` | Cheaper model for helpers and summaries |
| `RAHAT_PI_DAILY_USD_CAP` | `5` | Daily reserved-spend cap |
| `RAHAT_PI_MAX_RUN_TOKENS` | `300000` | Reserved tokens per message |
| `RAHAT_PI_MAX_OUTPUT_TOKENS` | `8000` | Output cap per model reply (thinking counts too) |
| `RAHAT_PI_COMPACT_AT_TOKENS` | `40000` | Summarize history above this size |
| `RAHAT_PI_DATA_DIR` | `./data` | Where conversations and state are stored |
| `RAHAT_PI_OFFLINE` | `0` | `1` = free scripted fake model |

Model IDs must exist in the pinned pi-ai catalog; startup fails clearly otherwise.

## Keep it running

On a systemd host, install the user unit in [`deploy/rahat-pi.service`](deploy/rahat-pi.service)
(steps are in the file). Without systemd, use the restart supervisor:

```bash
bash deploy/supervise.sh start    # restarts after a crash; logs in data/service.log
bash deploy/supervise.sh status
bash deploy/supervise.sh stop     # or: npm run cli -- stop
```

A clean `stop` is never restarted, so the kill switch keeps working.

## Development

```bash
npm test             # offline tests, including real SIGKILL restart tests (Linux)
npm run test:crash   # crash and restart tests only
npm run typecheck
npm run test:linux   # Windows only: full Linux suite inside WSL on your current, uncommitted files
```

`test:linux` copies the checkout (without `.env`, `data/`, or `.git`) to `~/rahat-pi-check`
in WSL and runs the typecheck and all tests there. It needs WSL with Node 22 and
bubblewrap (see "On Windows, use WSL") and never changes your files.

Tests use a fake model provider and a fake outbox; they make no paid calls.

| Folder | Contents |
|---|---|
| `src/harness/` | Pi Durable setup, storage, models, state, cost tracking |
| `src/extensions/` | Tools: memory, routines, calendar, web, workspace, subagents |
| `src/executor/` | Approval rules and the send-once executor |
| `src/policy/` | Tool allowlist, budgets, and caps |
| `src/web/` | Local web UI server and page |
| `tests/` | Unit, integration, and `crash/` restart tests |

## Documentation

| Document | Contents |
|---|---|
| [docs/VISION.md](docs/VISION.md) | Purpose and success criteria |
| [docs/tech_spec.md](docs/tech_spec.md) | As-built architecture, contracts, and limitations |
| [docs/PROGRESS.md](docs/PROGRESS.md) | Roadmap and change log |
| [AGENTS.md](AGENTS.md) | Instructions for AI coding agents working on this repo |

## Common problems

- **401 "User not found"**: OpenRouter rejected `OPENROUTER_API_KEY`; create a new key.
- **"Run token cap reached"** or **"summary is incomplete"**: raise
  `RAHAT_PI_MAX_RUN_TOKENS` / `RAHAT_PI_MAX_OUTPUT_TOKENS` to the `.env.example`
  values. Thinking models use part of the output limit for thinking.
- **Tests fail on plain Windows**: expected for the Unix-socket, sandbox, and `SIGKILL`
  tests. Run the full suite on Linux or in WSL.
- **`listen EACCES ... agent.sock` in WSL**: the repo is under `/mnt/<drive>`; clone it
  into the Linux home folder instead.

## Known limitations

- Calendar and sends are fixtures; no real connectors yet.
- Timezones with daylight saving time are not supported yet (routines assume 24-hour days).
- No web search, only fetching a known URL.
- Cost reservations are deliberately pessimistic, so caps trigger well before real spend reaches them.

## License

[MIT](LICENSE)
