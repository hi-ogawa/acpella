# Replace REPL Env Toggle With CLI Flag

## Problem Context

REPL/test-bot mode is currently enabled with `ACPELLA_TEST_BOT=1`. That makes a runtime mode look like environment configuration and requires npm scripts/tests to mutate env for behavior selection.

Replace that mode toggle with an explicit CLI flag:

```bash
node src/cli.ts --repl
```

Keep environment-backed values that are still configuration, such as `ACPELLA_TEST_CHAT_ID`.

## Reference Files

- `src/cli.ts` loads config, chooses real Telegram bot vs in-process test bot, and starts either polling or the REPL.
- `src/config.ts` is the only module reading `process.env`; remove `ACPELLA_TEST_BOT` from this layer.
- `src/e2e/helper.ts` spawns the service for smoke tests and should pass `--repl`.
- `package.json` has the `repl` script.
- `README.md` documents public run/config surface.

## Implementation Plan

1. Parse a small CLI options object in `src/cli.ts` from `process.argv.slice(2)`.
2. Use `--repl` to select the in-process test bot instead of `config.testMode`.
3. Remove `ACPELLA_TEST_BOT` from config schema and config docs.
4. Update scripts and e2e helper to pass `--repl`.
5. Run lint and tests.
