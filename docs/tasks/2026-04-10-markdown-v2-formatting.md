# Telegram MarkdownV2 Formatting

## Problem context and approach

`src/index.ts` currently sends agent output to Telegram via raw `ctx.reply(response)`. Telegram treats Markdown formatting as opt-in, and its `MarkdownV2` mode requires escaping a fixed set of special characters. Without a formatting layer, agent responses that contain characters like `_`, `*`, `[`, `]`, `(`, `)`, `.`, or `!` are fragile if we later enable Markdown parsing, and we cannot safely render structured plain text.

The approach is to add a single outbound formatting helper for Telegram replies. That helper will:

- escape the Telegram `MarkdownV2` reserved characters
- return reply options with `parse_mode: "MarkdownV2"`
- be used for both normal agent responses and daemon-generated error/status messages

This keeps Telegram-specific behavior at the transport boundary instead of leaking it into the agent or handler layers.

## Reference files and patterns

- `src/index.ts` — current Telegram bot wiring and outbound `ctx.reply(...)`
- `src/test-bot.ts` — fake Telegram transport used in tests; needs to expose reply metadata for assertions
- `src/e2e/basic.test.ts` — existing smoke coverage for daemon reply flow
- `docs/prd.md` — source task list item: "Markdown formatting (Telegram MarkdownV2)"

## Implementation plan

1. Add a small Telegram formatting module with:
   - `escapeTelegramMarkdownV2(text)`
   - `buildTelegramReply(text)`
2. Update the bot reply path in `src/index.ts` to use `buildTelegramReply(...)` for success and error cases.
3. Extend the fake test bot to capture `parse_mode` for `sendMessage`.
4. Add tests for escaping behavior and reply options, then run `pnpm test` and targeted static checks.
