# OpenClaw Reply Streaming Notes

## Problem context and approach

`src/lib/reply.ts` currently buffers streamed agent text until one of these happens:

- the buffer exceeds `MESSAGE_SPLIT_BUDGET`
- the caller explicitly calls `flush()`
- the caller calls `finish()`

This is simple and safe, but it can delay short or medium responses until the full agent turn completes. We inspected `refs/openclaw` for reference patterns around timeout-based flushing and draft/rewrite-style previews.

## Reference files/patterns to follow

- `refs/openclaw/src/channels/draft-stream-loop.ts`
  - Generic throttled draft update loop.
  - Tracks `pendingText`, `lastSentAt`, one timer, and one in-flight send promise.
  - `update(text)` replaces pending text rather than appending.
  - Sends immediately when outside the throttle window, otherwise schedules a timer.
  - `flush()` clears the timer, waits for in-flight work, sends pending text, and loops if more text arrived during the send.
  - If `sendOrEditStreamMessage()` returns `false`, it restores pending text and stops.
  - `stop()` clears pending text and the timer; `waitForInFlight()` lets cleanup avoid racing an already-started send.

- `refs/openclaw/src/channels/draft-stream-controls.ts`
  - Wraps the loop with finalizable lifecycle state.
  - Ignores updates after finalization.
  - `stop()` marks final and forces a flush.
  - `clear()` stops future updates, waits for in-flight work, then deletes or clears the preview.

- `refs/openclaw/extensions/telegram/src/draft-stream.ts`
  - Implements Telegram preview transport.
  - Uses `DEFAULT_THROTTLE_MS = 1000`, clamped to at least `250ms`.
  - Supports two transports:
    - native `sendMessageDraft` where available
    - fallback `sendMessage` followed by `editMessageText`
  - Debounces the first preview with `minInitialChars`, but finalization bypasses this so a short final answer is still sent.
  - Avoids duplicate edits by comparing rendered text and parse mode to the last sent value.
  - Stops streaming if rendered text exceeds Telegram max length.
  - Has `materialize()` to convert a draft preview into a permanent message, then clears stale draft text best-effort.
  - Has `forceNewMessage()` to rotate preview state at assistant-message boundaries or tool boundaries.

- `refs/openclaw/extensions/telegram/src/draft-chunking.ts`
  - Telegram draft preview defaults are smaller than final message limits:
    - `minChars = 200`
    - `maxChars = 800`
    - `breakPreference = "paragraph"`
  - Config clamps preview max to the channel text limit.

- `refs/openclaw/src/auto-reply/reply/block-reply-coalescer.ts`
  - Closest match to an idle-flush buffer.
  - Accumulates text payloads with a configured joiner.
  - Schedules an idle timer after enqueue.
  - On idle flush, it sends only when `bufferText.length >= minChars` unless forced.
  - Flushes immediately when adding another payload would exceed `maxChars`.
  - Flushes buffered text before media or metadata-conflicting payloads.
  - `stop()` only clears the timer.

- `refs/openclaw/src/auto-reply/reply/block-streaming.ts`
  - Default block stream coalescing:
    - `minChars = 800`
    - `maxChars = 1200`
    - `idleMs = 1000`
  - ACP streaming overrides idle coalescing to `350ms` in `refs/openclaw/src/auto-reply/reply/acp-stream-settings.ts`.

## Findings

OpenClaw has timeout-flush heuristics, but not in a single simple writer identical to `acpella`'s `Reply.stream()`.

There are two useful models:

1. Draft preview loop:
   - Better for editing or replacing one visible preview message.
   - Sends a full snapshot of current text on a throttle interval.
   - Needs lifecycle handling for finalization, clearing, in-flight sends, and stale previews.

2. Block reply coalescer:
   - Better fit for `acpella`'s append-only Telegram replies.
   - Buffers text chunks and flushes after an idle timeout.
   - Uses `minChars`, `maxChars`, and `idleMs` to avoid sending tiny updates too eagerly.

For `acpella`, the block coalescer pattern is the safer first step. It does not require Telegram message editing, draft APIs, or materialization. A minimal version could add an idle timer to `createResponseWriter`:

- `write(text)` appends to `bufferedText`
- oversized text still flushes immediately using existing split logic
- if buffer is non-empty and below limit, schedule idle flush
- a new `write()` resets the idle timer
- `flush()` and `finish()` clear the timer and flush synchronously
- `finish()` should still send `(no response)` if nothing was ever sent
- `stop`/cleanup support may be useful later if cancellation can abandon a writer with a live timer

The draft/rewrite system is more ambitious. It may be worth revisiting only after append-only streaming is stable:

- Telegram preview via `sendMessage`/`editMessageText` could reduce message spam.
- Native `sendMessageDraft` is not generally available and needs fallback.
- Preview finalization must avoid duplicate flashes and stale edits.
- Race handling matters when a send is in flight and a new assistant message/tool boundary starts.

## Implementation plan

1. Keep current append-only `Reply.stream()` behavior as the baseline.
2. Add optional writer config for idle coalescing:
   - `idleMs`, likely `350ms` to `1000ms`
   - `minChars`, likely small for `acpella` because Telegram replies are already user-visible final chunks
3. Add fake-timer unit tests:
   - coalesces writes inside idle window
   - flushes after idle window
   - does not idle-flush below `minChars`
   - `finish()` cancels timer and flushes immediately
   - oversized write still flushes immediately
   - cancellation or cleanup clears timer if a stop API is added
4. Defer draft/rewrite transport until there is a clear need to edit existing Telegram messages instead of sending append-only chunks.
