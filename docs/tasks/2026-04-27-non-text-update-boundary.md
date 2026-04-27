## Problem context and approach

Telegram output currently flushes buffered reply text at tool-call boundaries and on final finish. That means the handler is wired around a tool-call-specific hook even though the short-term goal is broader: treat any non-message ACP session update as a boundary that can flush already-buffered message text.

This change stays intentionally small. It does not attempt to solve the no-tool silent-turn problem yet. It only generalizes the current tool-call-specific callback into a non-message-update callback so the handler logic can flush on more ACP update types without baking that policy into a tool-call-only hook.

## Reference files/patterns to follow

- `src/handler.ts`
  - current `onToolCall` callback passed from `handlePrompt` into `handlePromptImpl`
  - ACP consume loop that branches on `agent_message_chunk`, `tool_call`, and `usage_update`
- `src/lib/reply.ts`
  - `flush()` is already safe to call on an empty buffer

## Implementation plan

1. Replace the `onToolCall` callback plumbing with a more general non-message-update callback.
2. Call that callback for every `sessionUpdate !== "agent_message_chunk"` before any update-specific handling.
3. Keep the current verbose tool-call output behavior inside the generalized callback.
4. Leave tests and broader progress/thought behavior for follow-up work.
