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
- The helper shells out to `opencode` on `PATH`, so this local experiment prepends `/home/hiroshi/.opencode/bin`.
- `global.event()` works from the SDK and carries session identity on normal session events.
- `sync` events have a different shape (`payload.syncEvent`) and should not be treated as normal `payload.properties` events.

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
- `listSessions` backed by real OpenCode `session.list`.
- `prompt` backed by real OpenCode `session.prompt`.
- Naive event-stream forwarding from `global.event()` to ACP `agent_message_chunk` updates.
- Final response fallback using `session.prompt` returned parts.

Still intentionally incomplete:

- `loadSession` is still a no-op.
- `closeSession` is still a no-op while deletion/close semantics are undecided.
- Prompt streaming is naive and not yet a correct completion-barrier implementation.
- Permission flow, file edits, tool call fidelity, model picker/config, modes, MCP mapping, history replay, and resource/image/file blocks are out of scope for this early prototype.

## Important Harness Insight

`AgentSessionProcess.prompt()` in `src/lib/acp/index.ts` is the key test harness:

- It returns `{ promise, consume }`.
- `consume()` yields ACP `SessionUpdate`s received through `client.sessionUpdate`.
- The queue finishes when `agent.connection.prompt()` resolves.

That means the harness directly models the bug class this branch is investigating. If the experimental adapter returns ACP `end_turn` before all streamed chunks have been emitted, `consume()` will close early and the test can catch it.

## Streaming Risk

The naive streaming implementation subscribes to `global.event()` inside `prompt`, filters events by `sessionID`, converts part snapshots into suffix deltas, emits ACP `agent_message_chunk`, then emits a final fallback chunk from the `session.prompt` response.

Known risks:

- Event part updates may be snapshots, not deltas, so suffix tracking must be correct per `part.id`.
- Event payload shape still needs to be confirmed against real prompt events.
- The current final fallback can duplicate already-streamed text unless reconciled against emitted part state.
- There is not yet a reliable flush barrier after `session.prompt` resolves.
- Aborting the event stream immediately after `session.prompt` resolves may reproduce the upstream truncation/order bug.

The next iteration should focus on observing and tightening this path, not adding broad ACP feature parity.

## Next Iteration Plan

1. Run `pnpm test-opencode` and inspect the behavior of the current real-prompt test.
2. If the test fails, first determine whether the issue is event shape, final response extraction, model output nondeterminism, or prompt/session lifecycle.
3. Add minimal instrumentation in `src/lib/opencode/agent.ts` or `src/lib/opencode/probe.ts` to summarize real prompt event types and part shapes.
4. Fix text extraction and duplicate handling before adding more features.
5. Add an explicit completion-barrier experiment:
   - subscribe before `session.prompt`,
   - track emitted part snapshots,
   - await `session.prompt`,
   - wait for either a real completion signal or a short event-idle window,
   - emit any missing final suffix from response parts,
   - only then return `end_turn`.
6. Once the barrier is credible, compare the experimental adapter against upstream `opencode acp` on prompts that previously showed truncation.

## Non-Goals

- Do not fork OpenCode unless the SDK/server boundary proves insufficient.
- Do not pursue feature parity with upstream `opencode acp` in this branch.
- Do not replace existing `opencode` or `opencode-gpt` agents yet.
- Do not solve acpella session model/config UX here; issue #143 tracks that separately.
- Do not document wrapper-based model overrides here; issue #144 tracks that separately.
