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
  - `src/lib/acp/index.ts`
  - `src/lib/acp/index.test.ts`
  - `src/lib/test-agent.ts`
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

## 2026-04-29 SDK usability check

Initial result: the package boundary appears intentionally consumable by third-party code.

Evidence:

- Published `@opencode-ai/sdk@1.14.29` exports `./v2`, `./v2/client`, `./v2/server`, and `./v2/gen/client` with `dist/*.d.ts` types.
- Local OpenCode source at `/home/hiroshi/code/others/opencode/packages/sdk/js/package.json` has the matching source exports.
- `packages/opencode/src/cli/cmd/acp.ts` imports `createOpencodeClient` from `@opencode-ai/sdk/v2` and constructs it against the in-process server URL.
- `packages/opencode/src/acp/agent.ts` uses only the SDK client for the ACP bridge path, including `sdk.global.event(...)` and `sdk.session.prompt(...)`.
- Generated v2 SDK has the core methods needed for the experiment: `global.health`, `global.event`, `session.list`, `session.create`, `session.messages`, `session.message`, `session.prompt`, `session.promptAsync`, and `session.status`.

Local probe:

- Added `@opencode-ai/sdk` as a dev dependency for this experiment branch.
- Added `experiments/opencode-sdk-probe/probe.ts`.
- Verified with `node experiments/opencode-sdk-probe/probe.ts` that Node can import `@opencode-ai/sdk/v2`, construct a client, and see the expected method surface without private imports.

Pending server smoke test:

- `opencode` is not currently on `PATH` in this shell.
- `/home/hiroshi/code/others/opencode` is available as source reference, but its package dependencies/runtime are not currently installed here (`bun` and package `node_modules` were not available in the checked shell).
- Next step is to choose a local OpenCode invocation path, then run the probe with `OPENCODE_BASE_URL` or an explicit URL and verify `global.health` plus `session.list` without sending a model prompt.

## 2026-04-29 SDK server helper smoke test

Follow-up result: the SDK also provides a third-party server lifecycle helper, but it shells out to an `opencode` binary on `PATH`.

Evidence:

- `@opencode-ai/sdk/v2` exports `createOpencodeServer` and `createOpencode`.
- Local source: `/home/hiroshi/code/others/opencode/packages/sdk/js/src/v2/server.ts`.
- `createOpencodeServer` runs `cross-spawn("opencode", ["serve", "--hostname=...", "--port=..."])`, parses `opencode server listening on ...`, and returns `{ url, close() }`.
- This is a usable third-party API, but callers must ensure the desired `opencode` binary is discoverable on `PATH`.

Probe update:

- `experiments/opencode-sdk-probe/probe.ts` now prepends `/home/hiroshi/.opencode/bin` to `PATH` for this local experiment.
- It supports `node experiments/opencode-sdk-probe/probe.ts server`, which starts a temporary OpenCode server through `createOpencodeServer({ port: 0 })`, runs `global.health` and `session.list`, then closes the server.

Verification:

```sh
node experiments/opencode-sdk-probe/probe.ts server
```

Observed output included:

```json
{ "serverUrl": "http://127.0.0.1:41503" }
{ "health": { "healthy": true, "version": "1.14.28" } }
{ "sessionListOk": true, "sessionCount": 0 }
```

No model prompt was sent. This verifies that a third-party script can use the published SDK to spawn/connect to a real OpenCode server and call basic APIs without private imports.

## 2026-04-29 No-prompt event/session smoke test

Follow-up result: `global.event()` is usable from the published SDK and carries enough session identity for basic correlation.

Probe update:

- `experiments/opencode-sdk-probe/probe.ts` now supports `events` mode.
- The mode starts a temporary server with `createOpencodeServer({ port: 0 })`.
- It subscribes to `client.global.event()` with an `AbortController`.
- It creates a titled session with `session.create({ title })`.
- It reads empty history with `session.messages({ sessionID })`.
- It logs summarized event shape and closes the server.

Verification:

```sh
node experiments/opencode-sdk-probe/probe.ts events
```

Observed event sequence included:

```text
server.connected
project.updated
session.created  properties: sessionID, info
sync             payload keys: type, syncEvent
session.updated  properties: sessionID, info
```

Observed session and message checks:

```json
{ "sessionCreated": { "id": "ses_2270d50d0ffex6hAM7UGYSRwXx", "title": "sdk-probe-1777461276289" } }
{ "messagesOk": true, "messageCount": 0 }
{ "eventCount": 5 }
```

Correlation notes:

- Session events include top-level `directory` and `project`.
- `session.created` and `session.updated` include `payload.properties.sessionID`.
- This is enough to filter global events down to a target session before testing prompt/message/part events.
- The `sync` event shape differs from normal bus events: it has `payload.syncEvent` rather than `payload.properties`.

No model prompt was sent. This is the last structural no-token check before testing a real `session.prompt` turn and comparing prompt response timing against streamed message/part events.

## Next pivot: ACP-first adapter shell

After the no-token SDK checks, the next step is to move from standalone SDK probing to an experimental ACP agent process. The reason is not primarily acpella end-to-end dogfooding. The reason is that ACP itself is the right model for iterating the custom OpenCode adapter boundary.

Rationale:

- The public SDK/server boundary is now sufficiently proven for initial iteration.
- ACP already models the important adapter concepts: sessions, prompt turns, streamed assistant/thought chunks, tool-call updates, cancellation, and `end_turn`.
- Iterating inside the ACP shape avoids ad-hoc probe code that will be thrown away when the adapter becomes real.
- Starting with an echo-only ACP agent validates the protocol skeleton before mixing in OpenCode prompt streaming.
- The OpenCode-backed implementation can then replace the echo internals incrementally while keeping the same ACP interface and tests.

Planned shape:

- Add `experiments/opencode-acp-agent/agent.ts`.
- Use `src/lib/test-agent.ts` as the local echo-agent reference.
- Use `@agentclientprotocol/sdk` directly for ACP stdio.
- Initially implement only:
  - initialize/client connection setup
  - in-memory session mapping for `newSession`/`loadSession` shape needed by acpella
  - `prompt` that emits `agent_message_chunk` with an echo response
  - `end_turn`
  - basic/no-op `cancel` only if required by the interface
- Start or prepare the OpenCode SDK client/server in the process only after the echo ACP shell works.

First ACP harness target:

1. Run the experimental agent through acpella's existing ACP test harness, not through Telegram.
2. Use `src/lib/acp/index.ts` `AgentManager` directly with a command like `node experiments/opencode-acp-agent/agent.ts`.
3. Follow `src/lib/acp/index.test.ts` patterns for `newSession`, `loadSession`, `listSessions`, `closeSession`, `prompt`, update collection, and `cancel`.
4. Use `src/lib/test-agent.ts` as the agent-side protocol reference for `AgentSideConnection`, `ndJsonStream`, session state, chunks, tool calls, thoughts, usage updates, and cancellation.
5. Validate protocol behavior: session creation/load, prompt, streamed chunk notification, and `end_turn` ordering.
6. Registering it as a separate acpella agent, e.g. `opencode-experimental`, is useful later but not the main milestone.

Non-goals for the first ACP shell:

- No OpenCode `session.prompt` call yet.
- No model/provider configuration.
- No permissions, file edits, commands, MCP mapping, or tool-call fidelity.
- No replacement of existing `opencode` or `opencode-gpt` agents.
- No requirement to wire through acpella/Telegram for the first shell.

Success criteria:

- `AgentManager` can spawn the experimental ACP agent from a test.
- The agent can create/load an ACP session.
- A prompt returns an echoed assistant message chunk and `end_turn` in the correct order.
- The ACP skeleton is simple enough to become the harness for the next OpenCode-backed prompt-ordering test.

Important test insight:

- `AgentSessionProcess.prompt()` in `src/lib/acp/index.ts` returns `{ promise, consume }`.
- `consume()` yields `SessionUpdate`s collected through `client.sessionUpdate`.
- The queue finishes when `agent.connection.prompt()` resolves.
- That means this harness directly models the bug class we care about: if an adapter resolves ACP `prompt()` / returns `end_turn` before all streamed chunks are emitted, `consume()` will close early.
- Therefore the existing ACP test infra is the right place to verify the future OpenCode completion barrier.

## 2026-04-29 Experimental ACP shell

Implemented the first ACP-first shell:

- Added `experiments/opencode-acp-agent/agent.ts`.
- It is a self-contained ACP stdio agent using `AgentSideConnection` and `ndJsonStream`.
- It persists minimal session state under `.acpella/.opencode-acp-agent.json` in the test cwd so it works with acpella's process-per-session `AgentManager` shape.
- It currently implements echo-only `prompt` and returns `stopReason: "end_turn"`.

Added ACP harness coverage:

- Added `src/lib/acp/opencode-experiment.test.ts`.
- The test uses `AgentManager` directly with command `node experiments/opencode-acp-agent/agent.ts`.
- It verifies `newSession`, `listSessions`, `prompt` update consumption, `end_turn`, and `closeSession`.

Verification:

```sh
pnpm vitest --project=unit src/lib/acp/opencode-experiment.test.ts
```

Result:

```text
1 test passed
```

Next implementation step: replace the echo body behind the same ACP shell with OpenCode SDK client/server initialization, then add a prompt-ordering test that can compare emitted ACP chunks against `prompt()` resolution.

## 2026-04-29 OpenCode-backed `listSessions`

Implemented only `listSessions` against real OpenCode, keeping `newSession`, `loadSession`, `prompt`, and `closeSession` in the current echo/fake shape.

Rationale:

- OpenCode already exposes session enumeration per cwd via `sdk.session.list({ directory, roots: true })`.
- The adapter should not invent an ACP-to-OpenCode session mapping unless needed.
- OpenCode's own ACP adapter uses OpenCode session IDs directly as ACP session IDs.

Implementation shape:

- `experiments/opencode-acp-agent/agent.ts` prepends `/home/hiroshi/.opencode/bin` to `PATH`.
- `listSessions` starts a temporary OpenCode server with `createOpencodeServer({ port: 0 })`.
- It creates a client with `createOpencodeClient({ baseUrl: server.url, directory: cwd })`.
- It returns ACP `sessions` mapped from OpenCode sessions: `sessionId`, `cwd`, `title`, `updatedAt`.
- It closes the temporary server in `finally`.

Test update:

- `src/lib/acp/opencode-experiment.test.ts` now expects `manager.listSessions()` to return `{ sessions: [] }` for the fresh temporary test cwd.
- This intentionally proves real OpenCode enumeration succeeds without depending on the fake echo `newSession` state.

Verification:

```sh
pnpm vitest --project=unit src/lib/acp/opencode-experiment.test.ts
```

Result:

```text
1 test passed
```
