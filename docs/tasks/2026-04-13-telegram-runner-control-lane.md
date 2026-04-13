# Telegram Runner Control Lane

## Problem Context And Approach

Issue context: `/cancel` can cancel an in-flight agent turn in the local REPL, but not reliably on real Telegram. acpella currently uses grammY built-in long polling through `bot.start()`. grammY's simple long polling processes update batches sequentially, so a `/cancel` update can sit behind the in-flight prompt update and cannot reach `activeSessions` until the prompt finishes.

Port the OpenClaw-style Telegram execution model:

1. Use `@grammyjs/runner` for concurrent polling dispatch instead of `bot.start()`.
2. Add per-Telegram-session sequentialization for normal messages.
3. Route `/cancel` onto a separate control lane so it can bypass the normal prompt lane for the same chat/thread.
4. Keep `handler.ts` as the owner of active session state and overlapping prompt rejection.

## OpenClaw References

Local reference repo: `refs/openclaw`

- `extensions/telegram/src/polling-session.ts`
  - Starts polling via `run(bot, runnerOptions)` from `@grammyjs/runner`.
- `extensions/telegram/src/monitor.ts`
  - Builds runner options with `sink.concurrency`.
- `extensions/telegram/src/bot.ts`
  - Registers `bot.use(sequentialize(getTelegramSequentialKey))`.
- `extensions/telegram/src/sequential-key.ts`
  - Normal chat/topic messages use a chat or topic key.
  - Abort text uses a separate `telegram:<chatId>:control` key.
- `src/auto-reply/reply/abort.ts`
  - Abort command handling cancels active runs and clears queues.

Key OpenClaw behavior to preserve in acpella: cancellation must not share the same sequential key as the active prompt it is trying to stop.

## acpella Reference Files

- `src/cli.ts`
  - Creates real Telegram bot or REPL test bot.
  - Currently calls `await bot.start()` for real Telegram.
  - Wires `bot.on("message:text", ...)` and awaits `handler.handle(...)`.
- `src/handler.ts`
  - Owns local command routing, `activeSessions`, `/cancel`, and overlapping prompt guard.
- `src/repl.ts`
  - In-process test bot path. Keep separate from real Telegram runner unless useful for tests.
- `src/e2e/basic.test.ts`
  - Current smoke tests exercise REPL mode, not real Telegram polling concurrency.

## Implementation Plan

1. Add `@grammyjs/runner` as a dependency.
2. In `src/cli.ts`, use `run(bot, runnerOptions)` for real Telegram mode instead of `await bot.start()`.
3. Add a small Telegram sequential key helper:
   - Direct chat: `tg:<chatId>`.
   - Forum topic: `tg:<chatId>:topic:<threadId>`.
   - `/cancel`: append/use `:control`, e.g. `tg:<chatId>:control` or `tg:<chatId>:topic:<threadId>:control`.
4. Register `bot.use(sequentialize(getSequentialKey))` before `bot.on("message:text", ...)`.
5. Keep normal `handler.handle(...)` awaited inside the middleware. The runner and sequential keys should provide the needed concurrency, so avoid fire-and-forget prompt handling in `cli.ts`.
6. Ensure `/cancel` still gets handled by acpella before prompt routing and is not forwarded to the agent.
7. Keep `activeSessions` guard in `handler.ts` as a second layer: normal overlapping prompts for the same session should get the existing system response.
8. Add tests around the key helper:
   - Same chat normal messages share a key.
   - Same forum topic normal messages share a key.
   - `/cancel` uses a distinct control key for the same chat/topic.
9. Add an integration-style test if practical by mocking/stubbing runner/sequentialize, or cover the CLI wiring enough to prevent regression.
10. Run `pnpm test` and `pnpm lint`.

## Scope Notes

- This task is about real Telegram polling concurrency, not ACP cancellation internals.
- Do not replace the REPL loop unless needed for tests; REPL Ctrl-C cancellation already has a separate local path.
- Do not introduce Telegram update dedupe/redelivery handling here.
- Keep runner concurrency conservative at first, e.g. a small fixed value or one config value later. The per-session sequential key is what protects same-chat prompt ordering.
