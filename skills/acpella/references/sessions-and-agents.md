# Sessions And Agents

Use this reference for everyday command-driven workflows around session context and ACP agent selection.

## What a session means

Each chat or thread is associated with an acpella session name. That session name maps to an ACP agent session so acpella can reconnect later.

In practice, session commands are for:

- seeing what conversation you are attached to
- starting fresh context
- loading an older ACP session
- closing a mapping you no longer want

## Session commands

Use:

- `/session current`
- `/session list`
- `/session new [agent]`
- `/session load <sessionId|agent:sessionId>`
- `/session close [sessionId|agent:sessionId]`

Common cases:

- after changing `.acpella/AGENTS.md`, run `/session new`
- if you want a clean start, run `/session new`
- if you know an older ACP session id, use `/session load ...`

## Agent commands

Use:

- `/agent list`
- `/agent new <name> <command...>`
- `/agent remove <name>`
- `/agent default [name]`

Typical flow:

```bash
/agent new codex codex-acp
/agent default codex
```

That registers a real ACP agent and makes it the default for future sessions.

## Session vs agent choice

Think of it this way:

- `/agent ...` manages what backends are available
- `/session ...` manages which conversation context you are attached to

## If things look wrong

If the wrong agent or session appears to be active, continue with `troubleshooting.md`.
