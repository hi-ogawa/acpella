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
| `docs/references.md`          | Optional source repositories          |

## Documentation

- Keep task plans, progress, worktree state, and handoff notes in the active issue, PR, or agent session rather than adding them to the repository.
- Put lasting behavior and decisions in the relevant canonical documentation.

## Source Layout

```text
src/
  *.ts             entrypoint/wiring or legacy app-shell modules; keep these thin
  lib/
    <feature>.ts   cohesive acpella production logic, not generic helpers
    <feature>/*    features with clear internal parts or stable sub-boundaries
    *.test.ts      focused module tests
  utils/
    index.ts       small generic runtime-agnostic helpers
    <name>.ts      standalone generic utility modules
  test/
    *.test.ts      service behavior tests through the app request surface
    cli/*          external CLI/process tests
```

## Rules

- Commit messages: use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`); add `!` for breaking changes
- File names: kebab-case
- Run `.ts` scripts with `tsx`
- Prefer `undefined` over `null`
- Prefer optional properties (`{ x?: T }`) over explicit undefined (`{ x: T | undefined }`)
- Make props/params required when all call sites always pass them
- Prefer a single options object over multiple primitive arguments (e.g. `fn({ a, b })` not `fn(a, b)`)
- Use braces for every `switch` case body (`case "x": { ... }`, `default: { ... }`)
- When changing setup, CLI commands, service management, session routing, agent registration, customization, cron, or troubleshooting behavior, check whether `README.md` and `skills/acpella` need matching updates.
- Use pnpm only; never create/commit package-lock.json or yarn.lock
