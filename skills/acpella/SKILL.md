---
name: acpella
description: >-
  Use when working on acpella itself: explaining or changing its runtime model,
  local command surface, setup and systemd flows, .acpella state files,
  debugging flow, or prompt and skill composition features such as
  .acpella/AGENTS.md, @... includes, and ::acpella directives.
---

# acpella

Use this skill when the task is about acpella itself rather than the contents of one user's home.

## Choose the smallest reference set

- **Runtime model / architecture**: read `references/runtime-model.md`.
- **Commands, routing, or user-visible interaction behavior**: read `references/interaction-surface.md`.
- **Bootstrap, install, `.env`, or first run**: read `references/bootstrap.md`.
- **Systemd setup, restart flow, or service logs**: read `references/systemd.md`.
- **On-disk state under `.acpella/`**: read `references/state-layout.md`.
- **Prompt composition, `.acpella/AGENTS.md`, includes, directives, or skill catalogs**: read `references/prompt-and-skills.md`.
- **Service failures, traces, or operational debugging**: read `references/debugging.md`.

Do not load every reference by default. Pick only the sections needed for the current task.

## Working rules

- Anchor claims to current repo sources such as `README.md`, `docs/architecture.md`, and the relevant `src/*.ts` modules.
- Separate acpella product behavior from user policy choices layered on top of acpella.
- When the task is about prompt behavior, read both `src/lib/prompt.ts` and `src/lib/prompt.test.ts`.
- When the task is about commands or message routing, read `src/handler.ts` and the corresponding tests.
- Prefer describing current behavior first, then propose or implement changes.
