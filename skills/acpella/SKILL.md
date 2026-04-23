---
name: acpella
description: >-
  Use when helping someone use or customize acpella itself: first-time setup,
  systemd service setup, prompt and skill customization, session and agent
  management, cron jobs, or troubleshooting.
---

# acpella

Use this skill when the task is about using or customizing acpella itself rather than the contents of one user's home.

## Route by user question

- **Bootstrap, install, `.env`, or first run**: read `references/bootstrap.md`.
- **Systemd setup, restart flow, or service logs**: read `references/systemd.md`.
- **Customizing behavior with `.acpella/AGENTS.md`, includes, directives, or skills**: read `references/customization.md`.
- **Managing sessions or ACP agents**: read `references/sessions-and-agents.md`.
- **Scheduled prompts and cron jobs**: read `references/cron.md`.
- **Things are not working as expected**: read `references/troubleshooting.md`.

Do not load every reference by default. Pick only the sections needed for the current task.

## Working rules

- Prefer user-facing explanations and workflows over internal implementation detail.
- Use `README.md` and existing public docs as the first source of truth.
- Read source files only when public docs do not answer the question or when the task is implementation work.
- When explaining a feature, describe current behavior first before proposing changes.
