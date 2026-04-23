# State Layout

Use this reference for what acpella stores under `.acpella/` and where that layout comes from.

## Home root

acpella resolves its working home from:

- `ACPELLA_HOME` if set
- otherwise `process.cwd()`

Primary source:

- `src/config.ts`

## Core `.acpella/` files

By default, acpella uses these paths under the home directory:

- `.acpella/AGENTS.md` - conventional custom prompt file
- `.acpella/state.json` - session and agent configuration state
- `.acpella/cron.json` - cron job definitions
- `.acpella/cron-state.json` - cron run state
- `.acpella/logs/` - runtime logs, including per-agent ACP prompt traces

Primary source:

- `src/config.ts`

## `state.json`

`state.json` stores lightweight runtime state such as:

- `defaultAgent`
- configured `agents`
- conversation-to-session mappings in `sessions`
- per-agent-session usage metadata in `agentSessions`

Primary source:

- `src/state.ts`

The important conceptual boundary is:

- acpella stores routing state and small metadata
- the ACP agent stores its own deeper session memory

## Cron files

For exact cron schemas and mutations, continue with:

- `src/cron/store.ts`
- `src/cron/command.ts`
- `src/cron/runner.ts`

At a high level:

- `cron.json` stores job definitions
- `cron-state.json` stores run records and scheduler-related state

## Logs

Per-session ACP traces are written under:

- `.acpella/logs/acp/<agentKey>/<agentSessionId>.jsonl`

Primary implementation anchor:

- `src/handler.ts`

## Editing guidance

Document the file layout and meaning first. When changing runtime state, prefer using acpella commands over hand-editing JSON unless the task specifically calls for file-level repair.
