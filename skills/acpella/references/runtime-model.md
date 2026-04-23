# Runtime Model

Use this reference for "what acpella is" and how the main runtime pieces fit together.

## Purpose

- acpella is a thin bridge between a messaging surface and an ACP-compatible agent.
- It keeps routing, delivery, and lightweight local state in acpella.
- It leaves deeper memory, tool execution, and model-specific behavior to the ACP agent.

Primary sources:

- `README.md`
- `docs/architecture.md`

## System model

At a high level:

```text
Telegram / local REPL
  -> acpella conversation router
  -> ACP agent adapter
  -> AI agent
```

Useful implementation anchors:

- `src/handler.ts` - request routing, local commands, prompt dispatch
- `src/acp/index.ts` - ACP process and session adapter

## Conversation model

- Each messaging conversation maps to one acpella session name.
- acpella stores only the lightweight mapping needed to reconnect that conversation to an ACP session.
- The ACP agent owns its own conversation state; acpella stores only the agent key, agent session id, and a small amount of extra metadata such as usage.

Primary implementation anchor:

- `src/state.ts`

## Session lifecycle

When handling a normal prompt:

- acpella resolves the current session mapping from local state
- if an ACP session already exists, it loads that session
- otherwise it creates a new ACP session, stores the new id, and prepends the first prompt built from `.acpella/AGENTS.md` if present
- then it sends the user prompt, optionally with message metadata prepended

Primary implementation anchors:

- `src/handler.ts`
- `src/lib/prompt.ts`

## Operational model

- Local service commands are handled by acpella, not sent to the agent.
- The service is restartable because local state is on disk and ACP session ids can be reloaded later.
- If an agent fails to start, load, or prompt, acpella reports a bounded error to the messaging surface instead of hiding the failure.

Primary sources:

- `docs/architecture.md`
- `src/handler.ts`

## When to read deeper files

- For ACP adapter details, continue with `src/acp/index.ts`.
- For reply chunking and system-message formatting, continue with `src/lib/reply.ts`.
- For cron delivery behavior, continue with `src/cron/runner.ts`.
