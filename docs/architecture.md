# Architecture

## Overview

acpella is a thin service that bridges a messaging channel (Telegram) to a coding agent via ACP (Agent Client Protocol). It keeps the messaging layer small while delegating agent behavior, tools, and memory to an ACP-compatible agent.

```
Telegram  ──►  acpella  ──►  ACP agent (Codex, Claude Code, ...)
              (service)      (subprocess)
```

**Why ACP**: ACP is the protocol Zed, Cursor, and other editors use to talk to coding agents. By speaking ACP, acpella is agent-agnostic — swap `ACPELLA_AGENT=codex` for `ACPELLA_AGENT=claude` without changing the service. The agent binary manages its own session state, tool execution, and memory.

**Why direct ACP**: acpella spawns the configured ACP agent and talks to it through the ACP TypeScript SDK. acpella owns Telegram session mapping and lightweight persistence, while the agent owns actual reasoning and tool execution.

## Components

### `src/cli.ts`

Single-file service. Three sections:

**ACP manager** — starts the configured agent subprocess, initializes ACP, creates or loads sessions, sends prompts, and extracts `agent_message_chunk` text to assemble the response.

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
handler(sessionName, text)
  │
  ├─► load existing session or create a new ACP session
  │
  ├─► if new and ACPELLA_PROMPT_FILE is configured:
  │     send initialization prompt
  │
  └─► send user prompt
        agent streams session/update messages
        service collects agent_message_chunk updates → joins text
  │
  ▼
ctx.reply(response)
```

## Session model

Each Telegram chat maps to one ACP session:

| Chat type    | Session name             |
| ------------ | ------------------------ |
| DM           | `tg-<chatId>`            |
| Group        | `tg-<chatId>`            |
| Forum thread | `tg-<chatId>-<threadId>` |

The session id is stored in `.acpella/state.json` under `ACPELLA_HOME`. `/session new` creates a
fresh session for the current chat/thread. If `ACPELLA_PROMPT_FILE` is configured, the prompt file is
sent once when a new session is created, including sessions created by `/session new`.

## ACP updates

The ACP agent emits `session/update` notifications:

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

acpella extracts text by filtering updates where `sessionUpdate === "agent_message_chunk"` and
joining `content.text` chunks.

## Key decisions

**Direct ACP subprocess** — avoids depending on a separate CLI for prompt dispatch while keeping the service agent-agnostic.

**No database** — session mapping lives in `.acpella/state.json`. Agent memory lives in the agent's working directory (`ACPELLA_HOME`). The service remains restartable.

**Custom prompt file** — `ACPELLA_PROMPT_FILE` is sent as a normal ACP prompt turn when a session is
created. Existing sessions are unchanged; restart acpella and run `/session new` to apply prompt file
changes to a chat/thread.
