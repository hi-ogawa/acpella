# OpenCode ACP Adapter Exploration

## Context

While dogfooding `opencode acp` as an acpella backend, assistant replies can appear truncated even though the ACP turn completes normally. The working hypothesis is an ordering bug around OpenCode's ACP adapter boundary: `sdk.session.prompt(...)` may resolve and return ACP `end_turn` before the separate `sdk.global.event()` SSE subscription has flushed all assistant part updates.

This branch explores whether acpella can use a smaller custom OpenCode ACP adapter, built over OpenCode's public SDK/server boundary, to make turn completion explicit and testable.

Work area:

- Worktree: `/home/hiroshi/code/personal/acpella-opencode-acp`
- Branch: `explore/opencode-acp-adapter`
- PR: https://github.com/hi-ogawa/acpella/pull/163
- Tracking issue: https://github.com/hi-ogawa/acpella/issues/150

Keep the live service checkout `/home/hiroshi/code/personal/acpella` untouched unless explicitly asked.

## References

- OpenCode source reference: `/home/hiroshi/code/others/opencode`
- OpenCode ACP command: `/home/hiroshi/code/others/opencode/packages/opencode/src/cli/cmd/acp.ts`
- OpenCode ACP agent: `/home/hiroshi/code/others/opencode/packages/opencode/src/acp/agent.ts`
- OpenCode ACP session manager: `/home/hiroshi/code/others/opencode/packages/opencode/src/acp/session.ts`
- OpenCode SDK package: `/home/hiroshi/code/others/opencode/packages/sdk/js`
- Acpella ACP client harness: `src/lib/acp/index.ts`
- Acpella ACP harness tests: `src/lib/acp/index.test.ts`
- Acpella test agent reference: `src/lib/test-agent.ts`

Related issues:

- https://github.com/anomalyco/opencode/issues/17505
- https://github.com/anomalyco/opencode/issues/15613
- https://github.com/anomalyco/opencode/issues/24494
- https://github.com/hi-ogawa/acpella/issues/143
- https://github.com/hi-ogawa/acpella/issues/144

## Current Direction

The experiment has moved from throwaway probes to a small OpenCode implementation area:

- `src/lib/opencode/agent.ts` — experimental ACP stdio agent backed incrementally by OpenCode SDK.
- `src/lib/opencode/probe.ts` — manual SDK/server/event probe utility.
- `src/lib/opencode/agent.test.ts` — dedicated ACP harness test for the experimental agent.

Tests are split so normal unit tests do not require local OpenCode:

- `pnpm test` runs the `unit` project and excludes `**/opencode/**`.
- `pnpm test-opencode` runs the dedicated `opencode` Vitest project.

This keeps OpenCode-specific behavior explicit while allowing fast acpella unit tests to remain independent of `/home/hiroshi/.opencode/bin/opencode`.

## Findings So Far

OpenCode's public SDK boundary is usable for third-party integration:

- Published `@opencode-ai/sdk@1.14.29` exports `./v2`, `./v2/client`, `./v2/server`, and generated client/types.
- `@opencode-ai/sdk/v2` exposes the APIs needed for the adapter experiment: `global.event`, `global.health`, `session.create`, `session.list`, `session.get`, `session.messages`, `session.prompt`, `session.promptAsync`, and `session.status`.
- `createOpencodeServer({ port: 0 })` can spawn `opencode serve`, parse the server URL, and expose `{ url, close() }`.
- The helper shells out to `opencode` on `PATH`, so the acpella service environment must include `/home/hiroshi/.opencode/bin`.
- `global.event()` works from the SDK and carries session identity on normal session events.
- `sync` events have a different shape (`payload.syncEvent`) and should not be treated as normal `payload.properties` events.

Important server/process model correction:

- Upstream `opencode acp` is already the OpenCode CLI process. It calls OpenCode source `Server.listen(...)` from inside that process and reuses one in-process HTTP server plus one SDK client until stdio/process exit.
- This experimental adapter is a separate Node ACP process. Calling SDK `createOpencodeServer(...)` from this process spawns a child `opencode serve` process via `cross-spawn`.
- Therefore the PATH issue came from `createOpencodeServer(...)` needing to locate the `opencode` executable, not from OpenCode's internal `Server.listen(...)`.
- SDK `createOpencodeServer(...)` returns `close()`, which kills the spawned `opencode serve` process. If the adapter keeps a server across methods, it should explicitly close it on adapter/process shutdown.
- Current implementation still starts and closes an SDK-created server per adapter method. That is correct enough for isolation but adds duplicated startup cost.

Timing instrumentation is currently gated behind `OPENCODE_ACP_TIMING=1`. Latest representative test run showed:

- `newSession`: server startup `2030ms` on a cold-ish run, `1123ms` on the next run; total `2217ms` / `1307ms`.
- `listSessions`: server startup `1161ms`; total `1346ms`.
- `loadSession`: server startup `1103ms`; total `1286ms`.
- `prompt`: server startup `1144ms` / `1160ms`; first delta `2691ms` / `2699ms`; total `2925ms` / `2833ms` for `Say exactly: ok`.

Compared with existing acpella ACP JSONL logs:

- Existing `opencode-gpt` dogfood logs had first visible text median around `2901ms` over 66 turns, with wide variation depending on tool use and model work.
- The prompt delta timing in this prototype is not obviously abnormal.
- The suspicious overhead is duplicated SDK server startup across `loadSession` and `prompt`; a normal loaded acpella turn likely pays about `1.1s` in `loadSession` and another `1.1s` in `prompt` before model timing is considered.

OpenCode's own ACP adapter uses OpenCode session IDs directly as ACP session IDs:

- `newSession` calls `sdk.session.create({ directory: cwd })` and returns `session.id`.
- `loadSession` calls `sdk.session.get({ sessionID, directory: cwd })`.
- `listSessions` calls `sdk.session.list({ directory: cwd, roots: true })`.
- The adapter keeps only ephemeral in-process state for cwd/model/mode/etc.; it does not maintain a persisted ACP-to-OpenCode session mapping.

This is the direction this experiment should follow unless a concrete blocker appears.

## Current Agent State

`src/lib/opencode/agent.ts` currently supports:

- ACP initialization via `AgentSideConnection` and `ndJsonStream`.
- `newSession` backed by real OpenCode `session.create`.
- `loadSession` backed by real OpenCode `session.get`.
- `listSessions` backed by real OpenCode `session.list`.
- `prompt` backed by real OpenCode `session.prompt`.
- Event-stream forwarding from OpenCode `message.part.delta` events to ACP `agent_message_chunk` and `agent_thought_chunk` updates.
- Basic `tool_call`, `tool_call_update`, and `usage_update` mapping.
- ACP `cancel` mapped to OpenCode `session.abort`.
- A session-status lifecycle barrier that waits for busy-to-idle before returning `end_turn`.
- Optional timing logs with `OPENCODE_ACP_TIMING=1` for method/server/prompt/event/delta phases.

Still intentionally incomplete:

- `closeSession` is still a no-op and is not a priority because acpella does not rely on it for the current dogfood path.
- Permission flow, file edits, tool call fidelity, model picker/config, modes, MCP mapping, history replay, and resource/image/file blocks are out of scope for this early prototype.
- SDK server/client lifetime is still per method; it should be moved to per adapter process before serious dogfooding.

## Important Harness Insight

`AgentSessionProcess.prompt()` in `src/lib/acp/index.ts` is the key test harness:

- It returns `{ promise, consume }`.
- `consume()` yields ACP `SessionUpdate`s received through `client.sessionUpdate`.
- The queue finishes when `agent.connection.prompt()` resolves.

That means the harness directly models the bug class this branch is investigating. If the experimental adapter returns ACP `end_turn` before all streamed chunks have been emitted, `consume()` will close early and the test can catch it.

## Streaming Risk

The naive streaming implementation subscribes to `global.event()` inside `prompt`, filters `message.part.delta` events by `sessionID`, emits ACP `agent_message_chunk`, then emits a final fallback chunk from the `session.prompt` response.

Known risks:

- The current final fallback can duplicate already-streamed text unless reconciled against emitted part state.
- There is not yet a reliable flush barrier after `session.prompt` resolves.
- Aborting the event stream immediately after `session.prompt` resolves may reproduce the upstream truncation/order bug.
- `message.part.delta` currently covers assistant text only; thought, tool, and usage updates still need explicit mapping.

The next iteration should focus on observing and tightening this path, not adding broad ACP feature parity.

## Remaining Tasks

Recommended next order:

1. Change SDK server/client lifetime from per method to per adapter process.
   - Start `createOpencodeServer(...)` lazily once on the `OpencodeAgent` instance.
   - Reuse the returned client for `newSession`, `loadSession`, `listSessions`, `prompt`, and `cancel`.
   - Keep passing `directory` per SDK call; cwd remains per session in the existing in-memory map.
   - Add explicit cleanup for the SDK-created `opencode serve` child process when the ACP adapter process/transport exits.

2. Rerun timing with `OPENCODE_ACP_TIMING=1`.
   - Confirm loaded-session turn no longer pays separate server startup in both `loadSession` and `prompt`.
   - Keep the instrumentation gated for now; remove or refine it before merging if it becomes noise.

3. Compare against upstream `opencode acp`.
   - Once the barrier is credible, run prompts that previously showed truncation through both adapters.
   - Use acpella ACP trace logs to compare final text and update ordering.

## Non-Goals

- Do not fork OpenCode unless the SDK/server boundary proves insufficient.
- Do not pursue feature parity with upstream `opencode acp` in this branch.
- Do not replace existing `opencode` or `opencode-gpt` agents yet.
- Do not solve acpella session model/config UX here; issue #143 tracks that separately.
- Do not document wrapper-based model overrides here; issue #144 tracks that separately.
