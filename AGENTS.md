# Agent Guide

## Quick Reference

| Command     | When                      |
| ----------- | ------------------------- |
| `pnpm test` | E2E                       |
| `pnpm lint` | Format + Lint + Typecheck |

## Key Docs

| File                          | Purpose                               |
| ----------------------------- | ------------------------------------- |
| `README.md`                   | User-facing setup, global CLI, config |
| `skills/acpella/SKILL.md`     | Operator/admin guide for agents       |
| `skills/acpella/references/*` | Detailed acpella workflows            |
| `docs/architecture.md`        | Design decisions, data flow           |
| `docs/references.md`          | Reference projects, local clone setup |
| `docs/tasks/YYYY-MM-DD-*.md`  | Per-task notes                        |

## Task Documents

When asked to plan the detail of task, create `docs/tasks/YYYY-MM-DD-<topic>.md` **before implementing**.

Task docs should enable **handoff to a fresh agent** - include enough context to continue without conversation history.

**Structure:**

- Problem context and approach
- Reference files/patterns to follow
- Implementation plan

## Rules

- Commit messages: use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`); add `!` for breaking changes
- File names: kebab-case
- Run `.ts` scripts with `node` (not `tsx`/`ts-node`)
- Prefer `undefined` over `null`
- Prefer optional properties (`{ x?: T }`) over explicit undefined (`{ x: T | undefined }`)
- Make props/params required when all call sites always pass them
- Prefer a single options object over multiple primitive arguments (e.g. `fn({ a, b })` not `fn(a, b)`)
- Use braces for every `switch` case body (`case "x": { ... }`, `default: { ... }`)
- When changing setup, CLI commands, service management, session routing, agent registration, customization, cron, or troubleshooting behavior, check whether `README.md` and `skills/acpella` need matching updates.
- Do not update existing `docs/tasks/*` notes just to reflect code refactors unless explicitly asked.
