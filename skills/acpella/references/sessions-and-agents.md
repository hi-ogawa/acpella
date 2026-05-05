# Sessions And Agents

Use this reference for everyday command-driven workflows around session context and ACP agent selection.

## What a session means

Each chat or thread is associated with an acpella session name. That session name maps to an ACP agent session so acpella can reconnect later.

In practice, session commands are for:

- starting fresh context
- loading an older ACP session
- closing a mapping you no longer want
- controlling automatic renewal for a conversation

Run session lifecycle commands from Telegram or the REPL conversation whose context you mean to control. Do not use `acpella exec` for `/session new` without `--target`, `/session load`, or `/session close`. Use `acpella exec /session list` and `acpella exec '/session info --target <sessionName>'` to discover existing session names and inspect known sessions for administrative commands such as cron creation. Use `acpella exec '/session new --target <sessionName>'` only when intentionally resetting a known existing acpella session for administrative workflows such as cron topics.

`/session list` is a local acpella state view. It reads `.acpella/state.json` only; it does not connect to ACP backends, verify mapped backend sessions, or discover unmapped backend sessions.

## Session commands

Use:

- `/session info [--target <sessionName>]`
- `/session list`
- `/session new [--target <sessionName>] [agent]`
- `/session load <sessionId|agent:sessionId>`
- `/session close [sessionId|agent:sessionId]`
- `/session config [--target sessionName] [verbose=off|tool|thinking|all] [renew=off|daily|daily:N]`

Common cases:

- after changing `.acpella/AGENTS.md`, run `/session new`
- if you want a clean start in the current conversation, run `/session new`
- use `/session new --target <sessionName>` to start a fresh ACP session for another existing acpella session
- if you know an older ACP session id, use `/session load ...`
- use `/session info [--target <sessionName>]` to inspect the selected agent, agent session id, verbose setting, renewal policy, and context usage
- use `/session list` to see all mapped acpella sessions without probing backend agents
- use `/session config` to show or update per-session settings (`verbose`, `renew`) in one place
- use `/session config verbose=off|tool|thinking|all` to control internal progress output for a session
- use `/session config renew=off|daily|daily:<hour>` to change whether a session renews automatically

`/session list` should show acpella session names, their selected agent, mapped agent session id when present, renewal policy, and cached context usage when available.

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

### Targeted `/session new` examples

```text
/session new --target tg--1003825149970-3433
/session new --target tg--1003825149970-3433 opencode
```

The target acpella session must already exist. If an agent is provided, acpella updates the target session's agent before clearing its associated ACP session id. This does not create a backend ACP session immediately; the next prompt for that acpella session starts the new backend session.

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
- `/agent sessions [agent]`
- `/agent new <name> <command...>`
- `/agent remove <name>`
- `/agent default [name]`

Use `/agent sessions [agent]` only when a human operator explicitly wants backend ACP session discovery. It may start or connect to configured agent processes and should report backend failures as diagnostics. Agents should not use it for routine administration or session selection; prefer `/session list` and `/session info --target <sessionName>` unless the user specifically asks to inspect backend agent sessions.

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
