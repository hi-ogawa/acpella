# Debugging

Use this reference for figuring out why acpella behavior is wrong, missing, or surprising.

## First split: what kind of problem is it?

Start by identifying whether the issue is mainly about:

- service startup / deployment
- local command routing
- ACP agent startup or prompt execution
- prompt composition
- state mismatch
- cron scheduling or cron delivery

## Service and deployment

For systemd setup and service log entrypoints, start with:

- `systemd.md`

The main live-service log entrypoint is:

```bash
journalctl --user -u acpella -f
```

## Command and routing issues

For problems such as:

- a slash command behaving unexpectedly
- a prompt being treated as a command or vice versa
- help/usage output looking wrong

Start with:

- `src/handler.ts`
- `src/handler.test.ts`
- `src/lib/command.ts`
- `src/lib/command.test.ts`

## Prompt composition issues

For problems involving:

- `.acpella/AGENTS.md`
- include expansion
- `::acpella` directives
- unexpected literal lines in the built prompt

Start with:

- `src/lib/prompt.ts`
- `src/lib/prompt.test.ts`

Important diagnostic clue:

- if an include or directive remains literal in the built prompt, acpella likely hit a fail-open path and preserved the original line

## State mismatches

For problems where the wrong session, agent, or usage data appears:

- inspect `src/state.ts`
- inspect `.acpella/state.json`
- cross-check with `/session ...` and `/agent ...` behavior in `src/handler.ts`

## ACP prompt traces

Each ACP prompt is logged to:

- `.acpella/logs/acp/<agentKey>/<agentSessionId>.jsonl`

These traces help distinguish:

- prompt text sent by acpella
- streamed updates from the ACP agent
- logged errors vs successful completion

Primary implementation anchor:

- `src/handler.ts`

## Cron issues

For scheduler state, job rendering, and delivery flow, continue with:

- `src/cron/store.ts`
- `src/cron/command.ts`
- `src/cron/runner.ts`

If the question is only about the file layout, also read `references/state-layout.md`.
