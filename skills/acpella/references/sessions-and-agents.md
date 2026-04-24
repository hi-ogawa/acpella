# Sessions And Agents

Use this reference for everyday command-driven workflows around session context and ACP agent selection.

## What a session means

Each chat or thread is associated with an acpella session name. That session name maps to an ACP agent session so acpella can reconnect later.

In practice, session commands are for:

- starting fresh context
- loading an older ACP session
- closing a mapping you no longer want

Run session lifecycle commands from Telegram or the REPL conversation whose context you mean to control. Do not use `pnpm cli exec` for `/session new`, `/session load`, or `/session close`. Use `pnpm cli exec /session list` and `pnpm cli exec '/session info <sessionName>'` only to discover existing session names and inspect known sessions for administrative commands such as cron creation.

## Session commands

Use:

- `/session info [sessionName]`
- `/session list`
- `/session new [agent]`
- `/session load <sessionId|agent:sessionId>`
- `/session close [sessionId|agent:sessionId]`
- `/session verbose on [sessionName]`
- `/session verbose off [sessionName]`

Common cases:

- after changing `.acpella/AGENTS.md`, run `/session new`
- if you want a clean start, run `/session new`
- if you know an older ACP session id, use `/session load ...`
- use `/session info [sessionName]` to inspect the selected agent, agent session id, verbose setting, and context usage
- use `/session verbose on|off [sessionName]` to show or hide tool-call output for a session

## Agent commands

Use:

- `/agent list`
- `/agent new <name> <command...>`
- `/agent remove <name>`
- `/agent default [name]`

Typical flow:

```bash
pnpm cli exec /agent new codex npx -y @zed-industries/codex-acp
pnpm cli exec /agent default codex
```

That registers a real ACP agent and makes it the default for future sessions.

For Codex ACP, `npx -y @zed-industries/codex-acp` is the portable registration path. If `@zed-industries/codex-acp` is installed globally and `codex-acp` is available on the same `PATH` used by acpella, registering `codex-acp` directly is also fine:

```bash
pnpm cli exec /agent new codex codex-acp
```

Codex ACP reads Codex CLI configuration through its own `-c key=value` override flag. For example, to run Codex without sandboxing:

```bash
pnpm cli exec /agent new codex npx -y @zed-industries/codex-acp -c sandbox_mode=danger-full-access
```

Check `codex-acp --help` for the current configuration override syntax before changing flags.

## Session vs agent choice

Think of it this way:

- `/agent ...` manages what backends are available
- `/session ...` manages which conversation context you are attached to

## If things look wrong

If the wrong agent or session appears to be active, continue with `troubleshooting.md`.
