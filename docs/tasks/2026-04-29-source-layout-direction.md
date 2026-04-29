# Source Layout Direction

## Problem context and approach

`src/lib` is accumulating mixed support code, but the repo is still small enough that a broad top-level `src/*` domain split would add more ceremony than clarity. The preferred direction is to treat root `src/*.ts` as legacy/app-shell territory, put new production logic under `src/lib/*`, and move generic helpers to a dedicated `src/utils` bucket.

`src/handler.ts`, `src/state.ts`, and `src/config.ts` may remain at the root for now, but their root placement should not be treated as the model for new code. New behavior should be factored into `src/lib/<feature>.ts` or `src/lib/<feature>/*` and wired from the root files only when needed.

The main concern is not that `src/lib/utils.ts` exists. The current generic utility files are still readable and trivial enough to keep as-is. The pressure point to manage over time is making utilities an honest peer category instead of burying them under a broad `lib` bucket.

## Reference files/patterns to follow

- Current top-level modules:
  - `src/cli.ts`
  - `src/config.ts`
  - `src/handler.ts`
  - `src/state.ts`
- Current subsystem directories:
  - `src/acp/*`
  - `src/cron/*`
  - `src/lib/telegram/*`
- Current generic utilities:
  - `src/lib/utils.ts`
  - `src/lib/utils-node.ts`

## Target convention

Prefer this direction for future organization:

```text
src/
  cli.ts
  handler.ts
  state.ts
  config.ts
  lib/
    acp/
    cron/
    telegram/
    systemd.ts
    ...
  utils/
    index.ts
    fs.ts
    ...
  bin/
  test/
    cli/
    cron.test.ts
    session.test.ts
    ...
```

Path guide:

- `src/*.ts`: legacy/app-shell territory. Keep these files thin; runtime startup, orchestration, compatibility boundaries, and wiring are acceptable here. Do not treat root placement as the model for new production logic.
- `src/handler.ts`: app orchestration only. Prefer adding new behavior to `src/lib/*` and calling it from the handler instead of expanding this file.
- `src/config.ts` and `src/state.ts`: current legacy root modules. They may move under `src/lib` during source-layout cleanup, but new config/state behavior should still be factored into clear implementation modules instead of growing the root files.
- `src/lib/<feature>.ts`: preferred home for new acpella production logic when the feature is cohesive and has one main responsibility. Colocate focused tests as `src/lib/<feature>.test.ts`.
- `src/lib/<feature>/*`: use when a feature has multiple internal parts, multiple focused tests, private helpers that should not sit in one large file, or stable sub-boundaries such as `store.ts`, `runner.ts`, or `command.ts`. Do not create a directory just because a feature might grow later.
- `src/lib/acp/*`, `src/lib/cron/*`, `src/lib/telegram/*`: implementation subsystems. Moving current `src/acp/*` and `src/cron/*` here is consistent with the direction.
- `src/utils/index.ts`: generic runtime-agnostic helpers that are still small and easy to scan. This is the eventual replacement for `src/lib/utils.ts`.
- `src/utils/fs.ts`: generic filesystem/Node helpers that are still small and easy to scan. This is the eventual replacement for `src/lib/utils-node.ts`.
- `src/utils/<name>.ts`: promoted generic utility modules when a helper becomes large, gains dedicated tests, or is easier to understand as a standalone unit.
- `src/lib/<name>.ts`: acpella implementation modules only, not generic support code.

## Test organization

`src/handler.test.ts` is effectively an end-to-end service test suite, not just a unit test for `handler.ts`. It exercises the app request surface across command routing, state persistence, cron, logs, replies, and ACP agent interaction. ACP starts a real agent process, so this test harness is already crossing an important process boundary even when the acpella service itself is in-process.

Prefer moving this coverage toward feature-named tests under `src/test`:

```text
src/test/
  basic.test.ts
  cron.test.ts
  ...
  cli/
    basic.test.ts
    codex/
      basic.test.ts
    helper.ts
```

Path guide:

- `src/test/*.test.ts`: full service behavior tests through the app request surface. Name files by user-facing feature or behavior, such as `cron.test.ts` or `session.test.ts`, not by `handler.ts`.
- `src/test/basic.test.ts`: initial landing place for the current broad `src/handler.test.ts` coverage. Split feature areas into separate `src/test/*.test.ts` files as the suite changes.
- `src/test/harness.ts`: shared in-process service test harness extracted from `src/handler.test.ts`.
- `src/test/cli/*`: external CLI/process tests. This is the destination for the current `src/e2e/*` tree.
- `src/lib/**/*.test.ts`: focused module tests for implementation modules, such as `src/lib/command.test.ts` or `src/lib/cron/timer.test.ts`.
- `src/handler.test.ts`: legacy location. Do not keep adding broad command, cron, session, or agent scenarios here.

## Non-goals

- Do not split `utils.ts` just for taxonomy.
- Do not create many top-level domain folders under `src` unless the repo grows enough that the current contained layout becomes hard to navigate.
- Do not move an existing module only because adjacent files were refactored.
- Do not update existing task notes just to reflect source-layout movement.

## Implementation plan

Initial mechanical migration:

| From                    | To                       |
| ----------------------- | ------------------------ |
| `src/acp/*`             | `src/lib/acp/*`          |
| `src/cron/*`            | `src/lib/cron/*`         |
| `src/lib/utils.ts`      | `src/utils/index.ts`     |
| `src/lib/utils-node.ts` | `src/utils/fs.ts`        |
| `src/e2e/*`             | `src/test/cli/*`         |
| `src/handler.test.ts`   | `src/test/basic.test.ts` |

After the mechanical moves, extract the shared service test setup from `src/test/basic.test.ts` to `src/test/harness.ts` only if it is needed for the first split; otherwise leave it for the first feature extraction. Run `pnpm lint` after import rewrites.

Follow-up migrations:

1. Split feature areas out of `src/test/basic.test.ts` as they change, such as `src/test/session.test.ts`, `src/test/agent.test.ts`, and `src/test/cron.test.ts`.
2. Consider moving `src/config.ts` and `src/state.ts` to `src/lib` as part of a cleanup, but keep the main priority on preventing additional logic from accumulating in root files.
3. If a utility grows beyond the broad `src/utils/index.ts` or `src/utils/fs.ts` files, graduate only that helper or category to a focused `src/utils/<name>.ts` file with matching focused tests.
