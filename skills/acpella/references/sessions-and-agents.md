# Sessions And Agents

Use this reference for everyday command-driven workflows around session context and ACP agent selection.

## What a session means

Each chat or thread is associated with an acpella session name. That session name maps to an ACP agent session so acpella can reconnect later.

In practice, session commands are for:

- starting fresh context
- loading an older ACP session
- closing a mapping you no longer want
- controlling automatic renewal for a conversation

Run session lifecycle commands from Telegram or the REPL conversation whose context you mean to control. Do not use `acpella exec` for `/session new`, `/session load`, or `/session close`. Use `acpella exec /session list` and `acpella exec '/session info <sessionName>'` only to discover existing session names and inspect known sessions for administrative commands such as cron creation.

## Session commands

Use:

- `/session info [sessionName]`
- `/session list`
- `/session list --all`
- `/session new [agent]`
- `/session load <sessionId|agent:sessionId>`
- `/session close [sessionId|agent:sessionId]`
- `/session config [--target sessionName] [verbose=off|tool|thinking|all] [renew=off|daily|daily:N]`

Common cases:

- after changing `.acpella/AGENTS.md`, run `/session new`
- if you want a clean start, run `/session new`
- if you know an older ACP session id, use `/session load ...`
- use `/session info [sessionName]` to inspect the selected agent, agent session id, verbose setting, renewal policy, and context usage
- use `/session list` to see all mapped acpella sessions; add `--all` to also show unmapped backend sessions
- use `/session config` to show or update per-session settings (`verbose`, `renew`) in one place
- use `/session config verbose=off|tool|thinking|all` to control internal progress output for a session
- use `/session config renew=off|daily|daily:<hour>` to change whether a session renews automatically

### `/session config` examples

```text
/session config
/session config verbose=thinking renew=daily
/session config --target tg--1003825149970-3433 verbose=tool
/session config renew=daily:6
/session config renew=off
```

No arguments shows the current session's config. One or more `key=value` pairs update the specified fields atomically. Use `--target <sessionName>` to target a different session. Use `renew=off` to disable automatic renewal.

Supported keys: `renew` (`off|daily|daily:N`) and `verbose` (`off|tool|thinking|all`).

By default, sessions do not auto-renew. When daily renewal is enabled, acpella checks the boundary immediately before the next live or cron prompt for that acpella session name. acpella does not create fresh ACP sessions on a background timer, and inactive conversations are not touched.

Examples:

```text
/session config renew=off
/session config renew=daily
/session config renew=daily:6
```

`daily` means daily at 04:00 in the acpella service timezone. `daily:6` means daily at 06:00. `off` disables automatic renewal. Use `/session info` to confirm the effective policy.

## Agent commands

Use:

- `/agent list`
- `/agent new <name> <command...>`
- `/agent remove <name>`
- `/agent default [name]`

Typical flow:

```bash
acpella exec /agent new codex npx -y @zed-industries/codex-acp
acpella exec /agent default codex
```

That registers a real ACP agent and makes it the default for future sessions.

## Agent-specific setup

Load only the backend reference needed for the agent being configured:

- **Codex ACP**: read [agents/codex.md](agents/codex.md).
- **OpenCode ACP**: read [agents/opencode.md](agents/opencode.md).

Use these references for backend-specific command paths, model flags, and configuration overrides. Keep the generic `/agent` and `/session` mental model in this file.

## Session vs agent choice

Think of it this way:

- `/agent ...` manages what backends are available
- `/session ...` manages which conversation context you are attached to

## If things look wrong

If the wrong agent or session appears to be active, continue with [troubleshooting.md](troubleshooting.md).
