# Prompt Loop ACP Trace Logs

## Problem Context And Approach

Issue #106 asks for ACP trace logs that improve observability when a session looks stuck, delayed, or malformed.

The desired scope for this pass is intentionally narrow:

- logging is an acpella application concern
- logging is only for prompt loop observability
- logs should stay in a raw JSONL form
- avoid introducing a separate logging subsystem

That means the implementation should not turn `src/acp/index.ts` into a general-purpose logging layer, and it should not trace non-prompt ACP lifecycle calls such as `newSession`, `loadSession`, `listSessions`, or `closeSession`.

Instead, the handler should log what it already owns during a prompt turn:

- the outbound prompt request content
- inbound raw `SessionUpdate` objects
- a small terminal record for completion / cancellation / error

Each prompt turn should append to a per-session file:

```text
.acpella/logs/acp/<agentKey>-<agentSessionId>.jsonl
```

## Reference Files And Patterns To Follow

- `src/handler.ts`
  - owns prompt turn orchestration today
  - already knows `agentKey`, `agentSessionId`, prompt text, and raw updates from `result.consume()`
- `src/config.ts`
  - central place for runtime file paths under `.acpella/`
- `src/lib/utils-node.ts`
  - existing filesystem persistence in the repo is simple and synchronous
  - follow that style instead of introducing a heavier abstraction
- `.gitignore`
  - `.acpella/` is already ignored, so the new runtime log path does not need extra git changes

## Implementation Plan

1. Add a config path for ACP prompt trace logs under `.acpella/logs/acp`.

2. In `handler.ts`, once the agent session is ready and the final `promptText` is known:
   - derive the trace file path from `agentKey` and `session.sessionId`
   - append a JSONL line for the outbound prompt request

3. During the existing `for await (const update of result.consume())` loop:
   - append one JSONL line per raw `update`

4. On terminal outcomes:
   - append a terminal JSONL record for `done`
   - append a terminal JSONL record for `error` before rethrowing

5. Keep logging best-effort:
   - trace write failures should go to stderr and must not fail the prompt turn

## Non-Goals

- Do not add general ACP transport tracing.
- Do not log session bootstrap traffic (`initialize`, `newSession`, `loadSession`).
- Do not add rotation or retention policy in this pass.
- Do not add tests in this implementation pass unless explicitly requested later.
