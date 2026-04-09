# Agent Guide

## Quick Reference

| Command           | When                         |
| ----------------- | ---------------------------- |
| `pnpm start`      | Run daemon (requires `.env`) |
| `pnpm dev`        | Run daemon with --watch      |
| `pnpm tsc`        | Type check                   |
| `pnpm lint`       | Format (with fixes)          |
| `pnpm lint-check` | Check formatting (no fixes)  |

## Key Docs

| File                | Purpose                         |
| ------------------- | ------------------------------- |
| `docs/prd.md`       | MVP features checklist, backlog |
| `docs/bootstrap.md` | Initial repo setup plan         |
| `docs/deploy.md`    | systemd unit, install steps     |
| `.env.example`      | All supported env vars          |

## Architecture

Thin daemon: Telegram ↔ acpx ↔ coding agent (Codex, Claude Code, etc.).

- **`src/index.ts`** — single-file daemon: config, acpx interface, telegram bot, entry point

Each Telegram chat maps to a named acpx session (`tg-<chatId>`). Forum threads get `tg-<chatId>-<threadId>`. The agent (acpx) runs as a subprocess; its binary is at `node_modules/.bin/acpx`.

## Conventions

- File names: kebab-case
- Run `.ts` scripts with `node` (not `tsx`/`ts-node`)
- Prefer `undefined` over `null`
- Import with `.ts` extensions (NodeNext resolution)

## Agent Rules

- **Never run long-running tasks** (`pnpm start`, `pnpm dev`)
- Use `pnpm tsc` to verify type correctness
- **Run `pnpm lint` before every commit**
- Confirm with user before committing

## Git Workflow

1. Commit logical changes separately
2. **Run `pnpm lint` before every commit**
3. Confirm with user before committing
4. **Never rebase, never amend, never force push**
