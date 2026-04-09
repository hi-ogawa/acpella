# Refactor: child process exec → spawn with debug logging

## Problem

`handler.ts` uses `execFile` (promisified) which:

- Buffers all output — no streaming visibility
- Swallows stderr — no debug info from acpx
- Makes it hard to add incremental logging

## Approach

1. Replace `execFile` with `spawn` in a small helper (`runAcpx`)
2. Collect stdout/stderr via stream events
3. Log debug output: command being run, stderr lines
4. Support `--verbose` flag on acpx when `ACPELLA_DEBUG` is set
5. Keep the same external API — `ensureSession` and `acpxPrompt` signatures unchanged

## Reference

- `src/handler.ts` — current `execFile` usage
- `src/e2e/helper.ts` — already uses `spawn` pattern for the daemon
- acpx CLI: `--verbose` flag enables debug logs (goes to stderr)

## Plan

- [ ] Add `runAcpx` helper that wraps `spawn` with promise, timeout, stdout/stderr collection, debug logging
- [ ] Wire `--verbose` when `ACPELLA_DEBUG` env is set
- [ ] Replace `execFile` calls in `ensureSession` and `acpxPrompt`
- [ ] Verify with `pnpm lint && pnpm tsc`
