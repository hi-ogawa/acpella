# Auto Reload Cron On External File Change

## Problem Context

Issue context: <https://github.com/hi-ogawa/acpella/issues/125>

acpella already supports cron definitions in `.acpella/cron.json`, but the running scheduler only sees file changes after a manual `/cron reload` or after in-app cron mutations. That is fine for command-driven management, but it is clumsy for direct file edits, syncing from another checkout, or changes applied by external tooling.

The current behavior is already structurally close to the desired feature:

- `CronStore.reload()` re-reads `cron.json` and `cron-state.json` from disk.
- `/cron reload` already calls `cronStore.reload()` and then `cronRunner.refresh()`.
- in-app `/cron add`, `/cron enable`, `/cron disable`, and `/cron delete` already refresh the in-memory scheduler.

So the missing behavior is narrow: when `.acpella/cron.json` changes outside acpella, the running service should notice and apply the new cron definitions automatically.

## Desired Behavior

When the acpella service is running and `.acpella/cron.json` changes on disk, acpella should:

1. detect the external file change,
2. debounce noisy write patterns,
3. reload cron definitions from disk,
4. refresh the in-memory scheduler if reload succeeds.

This should behave like an automatic `/cron reload`, but only for external file changes.

## Failure Policy

External file reload should be best-effort and conservative.

- If the updated file parses and validates, acpella should adopt it immediately.
- If the updated file is temporarily invalid, acpella should keep the existing in-memory schedule and log the error.
- A bad external edit should not stop the scheduler or clear existing timers.
- Internal writes to cron state should not trigger reload loops.

This matches the current manual `/cron reload` mental model while avoiding surprising schedule loss during partial saves.

## Reference Files

- `src/cli.ts`
  - creates `CronStore` and `CronRunner`
  - likely best place to attach runtime file-watch behavior
- `src/cron/store.ts`
  - owns file-backed cron/state data and `reload()`
- `src/cron/runner.ts`
  - owns scheduler refresh behavior
- `src/handler.ts`
  - current manual `/cron reload` behavior
- `src/handler.test.ts`
  - existing cron reload test coverage and handler-level patterns

## Implementation Direction

Prefer a small runtime watcher near the service wiring instead of pushing file-watch concerns into `CronStore`.

Why:

- `CronStore` is a file-backed state abstraction, not a process lifecycle owner
- file watching is a runtime/service concern
- `cli.ts` already wires `CronStore`, `CronRunner`, and service startup

Recommended shape:

1. Add a small helper that watches `config.cronFile`.
2. Debounce change events so editor save bursts collapse into one reload attempt.
3. On each settled change event:
   - call `cronStore.reload()`
   - call `cronRunner.refresh()` if reload succeeds
   - log an error and keep running if reload fails
4. Start the watcher during service startup and stop it during shutdown.

## Watcher Notes

Be careful about file-watch semantics.

- Simple `fs.watch` usage can miss or mis-shape events across platforms and for atomic-save editors.
- Rename/replace flows should still converge on reloading the target file.
- A lightweight polling or re-arm strategy is acceptable if it is more robust than a naive watcher.

The goal is not perfect low-level fidelity. The goal is reliable eventual application of external cron file changes in the normal local-dev/service environment.

## Side Note

This feature should stay focused on `.acpella/cron.json`.

`cron-state.json` is runtime bookkeeping, not user-edited configuration, so it does not need to participate in automatic reload for this task.

## Test Plan

Add focused tests around the new auto-reload path.

Minimum cases:

- external valid `cron.json` write updates `/cron list` without manual reload
- external invalid `cron.json` write does not replace the last good schedule
- subsequent valid write after an invalid one recovers correctly

The current `/cron reload` command test is a useful reference, but the new tests should prove the service updates itself without requiring the command.
