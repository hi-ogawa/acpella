# OpenCode ACP Adapter Exploration

## Problem context and approach

While dogfooding `opencode acp` as an acpella backend, assistant replies can appear truncated even though the ACP turn completes normally. The current hypothesis is an ordering bug in OpenCode's ACP adapter: `sdk.session.prompt(...)` can resolve and return ACP `end_turn` before the separate `sdk.global.event()` SSE subscription has flushed all assistant `message.part.delta` events.

This task is an exploration, not a production rewrite. The first goal is to verify whether OpenCode's public SDK/server boundary is sufficient for a third-party ACP adapter. If it is, build the smallest possible local prototype that proves a reliable completion barrier before returning ACP `end_turn`.

Work in this dedicated worktree and branch:

- Worktree: `/home/hiroshi/code/personal/acpella-opencode-acp`
- Branch: `explore/opencode-acp-adapter`

Keep the live service checkout `/home/hiroshi/code/personal/acpella` untouched unless explicitly asked.

## Reference files/patterns to follow

- Tracking issue: https://github.com/hi-ogawa/acpella/issues/150
- Related acpella issues:
  - https://github.com/hi-ogawa/acpella/issues/143
  - https://github.com/hi-ogawa/acpella/issues/144
- Related upstream OpenCode issues:
  - https://github.com/anomalyco/opencode/issues/17505
  - https://github.com/anomalyco/opencode/issues/15613
  - https://github.com/anomalyco/opencode/issues/24494
- Existing ACP client implementation:
  - `src/acp/*`
  - `docs/tasks/2026-04-10-acp-sdk-client.md`
- Repo conventions:
  - `AGENTS.md`
  - `docs/tasks/2026-04-29-source-layout-direction.md`

Expected OpenCode topology to verify:

```text
ACP stdio
  <-> OpenCode ACP adapter
  <-> @opencode-ai/sdk/v2 HTTP/SSE client
  <-> localhost OpenCode server
  <-> OpenCode internals
```

If this topology is accurate, a standalone experimental adapter should be able to start or connect to `opencode serve` and use `@opencode-ai/sdk/v2` as the integration layer without forking OpenCode.

## Initial action list

1. Inspect OpenCode's published SDK surface.
   - Confirm package name, import paths, generated types, and whether `@opencode-ai/sdk/v2` is intended for third-party use.
   - Verify session APIs: create, load/list if available, prompt, messages/history.
   - Verify event APIs: `global.event()` SSE shape, event names, payload IDs, and completion/status signals.

2. Build a tiny SDK probe before any ACP adapter work.
   - Place it under an obviously experimental path, such as `experiments/opencode-sdk-probe/`.
   - Start or connect to an OpenCode server.
   - Create a session.
   - Subscribe to raw global events.
   - Send one prompt.
   - Log prompt response timing versus SSE event timing.
   - Record whether deltas can arrive after `session.prompt` resolves.

3. Decide whether the SDK exposes enough information for a completion barrier.
   - Prefer an explicit assistant message or part completion event if available.
   - Otherwise check whether message history/status can confirm final output.
   - Treat idle-timeout-only barriers as fallback evidence, not a satisfying final design.

4. Only after the SDK probe passes, implement a minimal ACP adapter prototype.
   - Keep initially: `initialize`, `newSession`, `loadSession`, `prompt`, assistant text chunks, thought chunks, minimal tool call/update forwarding, and maybe basic `cancel`.
   - Drop initially: permission flow, file edits, model picker/config, commands, MCP mapping, fork/resume, history replay, resource/image/file blocks, fancy locations/diffs, and auth terminal flow.

5. Register and dogfood as a separate experimental acpella agent.
   - Do not replace existing agents.
   - Compare the same prompts through upstream `opencode acp` and the prototype.
   - Use acpella trace logs to compare event ordering and final delivered text.

6. Decide the outcome.
   - If the SDK is sufficient, keep polishing the local experiment or prepare a standalone package direction.
   - If the SDK is insufficient, document the missing API precisely and use the evidence for an upstream OpenCode issue or PR.

## Non-goals

- Do not fork OpenCode unless the SDK/server boundary proves insufficient.
- Do not pursue full feature parity with upstream `opencode acp` initially.
- Do not wire the prototype into production acpella service state during the first exploration.
- Do not solve acpella session model/config UX in this task; issue #143 tracks that separately.
- Do not document wrapper-based model overrides here; issue #144 tracks that separately.

## First milestone

Produce a raw event-ordering note from the SDK probe that answers:

1. Can a third-party script use `@opencode-ai/sdk/v2` against `opencode serve` without private imports?
2. Can it correlate one submitted prompt to the matching assistant message and parts?
3. Is there a reliable completion signal before returning ACP `end_turn`?
4. Does the current truncation hypothesis reproduce as `session.prompt` resolving before all SSE deltas are observed?
