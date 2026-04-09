# Env Prefix Rename

## Problem context and approach

The daemon used a mix of unprefixed environment variables such as `TELEGRAM_BOT_TOKEN` and `AGENT`, plus partially prefixed test-only variables. This made acpella-owned configuration inconsistent and harder to recognize.

The fix is to standardize the runtime configuration on `ACPELLA_*`, including `ACPELLA_HOME` for the agent working directory, and to update runtime code, examples, tests, and docs together. The real bot startup path should also refuse to run without an explicit allowed-user list.

## Reference files and patterns to follow

- `src/index.ts` - Telegram bot config, allowlist handling, startup validation
- `src/handler.ts` - default agent and working-directory env reads
- `.env.example` - canonical env template
- `README.md` - user-facing config docs
- `docs/deploy.md` - deployment setup docs
- `docs/architecture.md` - architecture terminology and env references
- `docs/tasks/2026-04-09-e2e-test.md` - existing note mentioning test env names

## Implementation plan

1. Replace unprefixed runtime env reads with `ACPELLA_*` names.
2. Rename the working-directory env from `ACPELLA_CWD` to `ACPELLA_HOME`.
3. Update `.env.example`, scripts, tests, and docs to match the final naming scheme.
4. Require `ACPELLA_TELEGRAM_ALLOWED_USER_IDS` to be non-empty when starting the real bot.
5. Run targeted verification with `pnpm test` and `pnpm tsc`.
