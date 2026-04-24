---
name: acpella
description: >-
  Use when helping someone use or customize acpella itself: first-time setup,
  CLI usage for slash-command administration, systemd service setup, prompt and
  skill customization, session and agent management, cron jobs, or
  troubleshooting.
---

# acpella

Use this skill when the task is about using or customizing acpella itself rather than the contents of one user's home.

## Command surface

Administrative slash commands use the same text syntax across Telegram, the local REPL, and local one-shot execution.

Use `pnpm cli exec <slash-command...>` only for local shell administration of acpella itself: inspecting or changing installation-wide state, listing configured objects, or running setup commands.

Good `exec` examples:

```bash
pnpm cli exec /status
pnpm cli exec /agent list
pnpm cli exec /session list
pnpm cli exec /cron list
pnpm cli exec /service systemd install
```

Do not use `exec` to send normal agent prompts. Do not use `exec` for session lifecycle actions that depend on the current Telegram or REPL conversation context, such as `/session new`, `/session load`, or `/session close`. Use `/session list` and `/session info <sessionName>` through `exec` only to discover or inspect existing sessions for administrative commands such as cron creation.

## Route by user question

- **Bootstrap, install, `.env`, or first run**: read [references/bootstrap.md](references/bootstrap.md).
- **Systemd setup, restart flow, or service logs**: read [references/systemd.md](references/systemd.md).
- **Customizing behavior with `.acpella/AGENTS.md`, includes, directives, or skills**: read [references/customization.md](references/customization.md).
- **Managing sessions or ACP agents**: read [references/sessions-and-agents.md](references/sessions-and-agents.md).
- **Scheduled prompts and cron jobs**: read [references/cron.md](references/cron.md).
- **Things are not working as expected**: read [references/troubleshooting.md](references/troubleshooting.md).

Do not load every reference by default. Pick only the sections needed for the current task.

## Working rules

- Prefer user-facing explanations and workflows over internal implementation detail.
- Treat this skill and its references as the usage guide; it may be installed outside the acpella repository.
- Read repository docs or source files only when the task is implementation work or the bundled skill references do not answer the question.
- When explaining a feature, describe current behavior first before proposing changes.
