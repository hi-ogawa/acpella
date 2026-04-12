# Architecture

## Overview

acpella is a thin service that bridges a messaging channel (Telegram) to a coding agent via ACP (Agent Client Protocol). It replaces OpenClaw with ~150 lines by delegating all agent complexity to acpx.

```
Telegram  ──►  acpella  ──►  acpx  ──►  agent (Codex, Claude Code, ...)
              (service)    (CLI)        (ACP subprocess)
```

**Why ACP**: ACP is the protocol Zed, Cursor, and other editors use to talk to coding agents. By speaking ACP, acpella is agent-agnostic — swap `ACPELLA_AGENT=codex` for `ACPELLA_AGENT=claude` without changing the service. The agent binary manages its own session state, tool execution, and memory.

**Why acpx**: acpx is a standalone ACP client CLI. acpella shells out to it instead of speaking ACP directly, which keeps the service code minimal and offloads session management to acpx.

## Components

### `src/cli.ts`

Single-file service. Three sections:

**acpx interface** — `ensureSession` and `acpxPrompt` shell out to `node_modules/.bin/acpx`. `acpxPrompt` runs `acpx ... prompt <text>` with `--format json`, capturing stdout as JSONRPC-envelope newline-delimited JSON, then extracts `agent_message_chunk` text to assemble the response.

**Telegram** — grammy long-polling bot. One handler: `message:text`. Maps each chat/thread to a session name (`tg-<chatId>` or `tg-<chatId>-<threadId>`), calls `acpxPrompt`, replies with the result.

**main** — reads env config, constructs the bot, starts polling.

## Data flow

```
User sends Telegram message
  │
  ▼
grammy bot handler
  │  checks allowlists (ACPELLA_TELEGRAM_ALLOWED_USER_IDS, ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS)
  │  derives session name from chatId + threadId
  ▼
acpxPrompt(sessionName, text)
  │
  ├─► ensureSession → acpx sessions ensure
  │     starts agent subprocess if not running
  │
  └─► acpx --format json <agent> prompt <text>
        agent runs, streams JSONRPC lines to stdout
        service collects agent_message_chunk lines → joins text
  │
  ▼
ctx.reply(response)
```

## Session model

Each Telegram chat maps to one acpx session:

| Chat type    | Session name             |
| ------------ | ------------------------ |
| DM           | `tg-<chatId>`            |
| Group        | `tg-<chatId>`            |
| Forum thread | `tg-<chatId>-<threadId>` |

`ensureSession` is called before every prompt — acpx is idempotent if the session already exists. The agent process runs as a long-lived subprocess managed by acpx; acpella does not own its lifecycle.

## acpx output format

`acpx --format json` emits newline-delimited JSONRPC 2.0 envelopes:

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "...",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": { "type": "text", "text": "Hello" }
    }
  }
}
```

acpella extracts text by filtering `params.update.sessionUpdate === "agent_message_chunk"` and joining `params.update.content.text` chunks.

## Key decisions

**Single file** — the service is small enough that modules add indirection without benefit. Split when it grows.

**Shell out to acpx** — avoids owning the ACP client/session lifecycle. Tradeoff: subprocess overhead per prompt, no streaming to Telegram. Acceptable for a personal assistant.

**No database** — session state lives in acpx. Memory lives in the agent's working directory (`ACPELLA_HOME`). The service is stateless and restartable.
