# Agent Guide

## Quick Reference

| Command                 | When                         |
| ----------------------- | ---------------------------- |
| `pnpm start`            | Run daemon (requires `.env`) |
| `pnpm dev`              | Run daemon with --watch      |
| `pnpm lint && pnpm tsc` | Format (with fixes)          |

## Key Docs

| File                   | Purpose                               |
| ---------------------- | ------------------------------------- |
| `docs/prd.md`          | MVP features checklist, backlog       |
| `docs/architecture.md` | Design decisions, data flow           |
| `docs/references.md`   | Reference projects, local clone setup |
| `docs/tasks/`          | Per-task notes                        |

## Architecture

Thin daemon: Telegram ↔ acpx ↔ coding agent (Codex, Claude Code, etc.).

- **`src/index.ts`** — single-file daemon: config, acpx interface, telegram bot, entry point

Each Telegram chat maps to a named acpx session (`tg-<chatId>`). Forum threads get `tg-<chatId>-<threadId>`. The agent (acpx) runs as a subprocess; its binary is at `node_modules/.bin/acpx`.

## Conventions

- File names: kebab-case
- Run `.ts` scripts with `node` (not `tsx`/`ts-node`)
- Prefer `undefined` over `null`
- Prefer optional properties (`{ x?: T }`) over explicit undefined (`{ x: T | undefined }`)
- Make props/params required when all call sites always pass them
- Import with `.ts` extensions (NodeNext resolution)
