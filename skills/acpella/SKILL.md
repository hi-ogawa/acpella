---
name: acpella
description: >-
  Use when helping someone use or customize acpella itself: slash commands
  including /agent, /session, /cron, /status, /service, and /help; first-time
  setup; CLI usage; systemd service setup; prompt and skill customization;
  session and agent management; cron jobs; or troubleshooting.
---

# acpella

Acpella is a small bridge from a messaging surface, currently Telegram or the local REPL, to an ACP-compatible agent such as Codex ACP. Acpella owns delivery, slash-command routing, session mappings, cron scheduling, and `.acpella` state. The selected ACP agent owns the actual assistant behavior, tool execution, and long-running agent session.

## Working model

- Acpella source lives at https://github.com/hi-ogawa/acpella.
- The normal operator CLI is the globally linked `acpella` command, installed from the source checkout with `pnpm link --global`.
- `ACPELLA_HOME` is the working directory acpella uses for agent sessions and acpella state.
- Acpella stores its own state under `ACPELLA_HOME/.acpella/`, including session mappings, configured agents, cron jobs, logs, and optional custom instructions.
- A Telegram chat/thread or REPL context maps to an acpella session name.
- An acpella session points at a selected ACP agent and, after use, an agent session id.
- Slash commands such as `/agent`, `/session`, `/cron`, `/status`, and `/service` are handled by acpella, not sent to the agent.
- Normal user prompts are forwarded to the selected ACP agent.

Use this skill when the task is about operating acpella itself: setup, service management, agent registration, session routing, prompt customization, cron jobs, or troubleshooting. For tasks about the user's project inside `ACPELLA_HOME`, follow that project's own instructions instead.

## Command surface

Administrative slash commands use the same text syntax across Telegram, the local REPL, and local one-shot execution, but they run inside whichever acpella process receives them.

When unsure which slash command or arguments to use, start with `/help` from Telegram, the local REPL, or `acpella exec /help`. Treat it as the source of truth for the currently installed command surface.

## Command process scope

- Telegram commands are handled by the long-running acpella bot service.
- REPL commands are handled by that REPL process.
- `acpella exec <slash-command...>` starts a separate short-lived acpella process, handles one command, then exits.

Commands that only read or mutate shared `.acpella` state, such as `/agent list`, `/session list`, `/cron add`, or `/cron update`, are usually fine through `exec`.

Commands that control process-local runtime state, such as `/cron start`, `/cron stop`, `/session new` without `--target`, `/session load`, or `/session close`, must be sent to the process whose runtime state should change. Do not use `exec` to control another running acpella service.

Use `acpella exec <slash-command...>` only for local shell administration of acpella itself: inspecting or changing installation-wide state, listing configured objects, or running setup commands.

Command examples use `acpella`, which assumes the global CLI is linked to the checkout/version that owns the running service. If it is not, run `pnpm link --global` from the intended checkout or use that installation's equivalent acpella CLI entrypoint.

Good `exec` examples:

```bash
acpella exec /status
acpella exec /agent list
acpella exec /session list
acpella exec /cron list
acpella exec /service systemd install
```

Do not use `exec` to send normal agent prompts. Do not use `exec` for session lifecycle actions that depend on the current Telegram or REPL conversation context, such as `/session new` without `--target`, `/session load`, or `/session close`. Use `/session list` and `/session info --target <sessionName>` through `exec` to discover or inspect existing sessions. Use `/session new --target <sessionName>` through `exec` only when intentionally resetting a known existing acpella session for administrative workflows such as cron topics.

## Route by user question

- **Bootstrap, install, `.env`, or first run**: read [references/bootstrap.md](references/bootstrap.md).
- **Systemd setup, restart flow, or service logs**: read [references/systemd.md](references/systemd.md).
- **Customizing behavior with `.acpella/AGENTS.md`, includes, directives, or skills**: read [references/customization.md](references/customization.md).
- **Managing sessions or ACP agents**: read [references/sessions-and-agents.md](references/sessions-and-agents.md). For backend-specific registration flags, follow its links under `references/agents/`.
- **Scheduled prompts and cron jobs**: read [references/cron.md](references/cron.md).
- **Things are not working as expected**: read [references/troubleshooting.md](references/troubleshooting.md).

Do not load every reference by default. Pick only the sections needed for the current task.

## How to use this skill

- Start from the route table above and load only the reference needed for the current task.
- Treat this skill and its references as the usage guide; it may be installed outside the acpella repository.
- Read repository docs or source files only when the task is implementation work or the bundled skill references do not answer the question.
