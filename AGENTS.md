# Agent Guide

## Quick Reference

| Command     | When                    |
| ----------- | ----------------------- |
| `pnpm test` | E2E smoke test (vitest) |
| `pnpm lint` | Lint                    |

## Key Docs

| File                         | Purpose                               |
| ---------------------------- | ------------------------------------- |
| `docs/prd.md`                | MVP features checklist, backlog       |
| `docs/architecture.md`       | Design decisions, data flow           |
| `docs/references.md`         | Reference projects, local clone setup |
| `docs/tasks/YYYY-MM-DD-*.md` | Per-task notes                        |

## Architecture

Thin service: Telegram ↔ acpx ↔ coding agent (Codex, Claude Code, etc.).

- **`src/cli.ts`** — single-file service: config, acpx interface, telegram bot, entry point

Each Telegram chat maps to a named acpx session (`tg-<chatId>`). Forum threads get `tg-<chatId>-<threadId>`. The agent (acpx) runs as a subprocess; its binary is at `node_modules/.bin/acpx`.

## Task Documents

For non-trivial work, create `docs/tasks/YYYY-MM-DD-<topic>.md` **before implementing**.

Task docs should enable **handoff to a fresh agent** - include enough context to continue without conversation history.

**Structure:**

- Problem context and approach
- Reference files/patterns to follow
- Implementation plan

## Conventions

- File names: kebab-case
- Run `.ts` scripts with `node` (not `tsx`/`ts-node`)
- Prefer `undefined` over `null`
- Prefer optional properties (`{ x?: T }`) over explicit undefined (`{ x: T | undefined }`)
- Make props/params required when all call sites always pass them
- Prefer a single options object over multiple primitive arguments (e.g. `fn({ a, b })` not `fn(a, b)`)
- Import with `.ts` extensions (NodeNext resolution)

## Rule

- Never remove `TODO: review slop` comment
