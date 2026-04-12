# Replace acpx subprocess with direct ACP TypeScript SDK client

## Problem

acpella currently shells out to the `acpx` CLI binary for every prompt. This adds:

- Subprocess spawn overhead per message
- NDJSON stdout parsing layer
- Dependency on acpx's session persistence (disk) and queue ownership (background process)
- An extra binary dep that is doing more than we need

acpx wraps the ACP TypeScript SDK with session persistence, prompt queueing, and agent process management. As a long-running daemon, acpella can own all of that directly in-process.

## Approach

Replace `src/handler.ts` with an in-process ACP client:

1. **Spawn the agent adapter** — `ACPELLA_AGENT` is a shorthand (e.g. `codex`) that maps to an adapter command (e.g. `npx @zed-industries/codex-acp`); acpella spawns that subprocess and connects via `ndJsonStream` (stdio transport), same as acpx does internally
2. **Implement the `Client` interface** — mainly auto-approve permission requests (`--approve-all` equivalent) and accumulate `agent_message_chunk` updates
3. **Hold sessions in memory** — a `Map<sessionName, { conn, agentSessionId }>` in the daemon process; sessions survive across messages, reset on `/reset`, lost on daemon restart (acceptable for MVP)
4. **No prompt queue needed** — grammY serializes updates per-chat already

External API (`handle(text, session)`) stays the same. Nothing in `cli.ts` changes.

## Reference

- `src/handler.ts` — current acpx interface to replace
- `refs/acpx/src/acp/client.ts` — real-world example of spawning agent + SDK wiring
- `refs/acp-ts-sdk/src/acp.ts` — `ClientSideConnection`, `Client` interface
- `refs/acp-ts-sdk/src/stream.ts` — `ndJsonStream` for stdio transport
- `refs/acp-ts-sdk/src/examples/client.ts` — minimal SDK usage example

## Open questions

- Agent registry — `codex`/`claude` shorthands currently resolve inside acpx; acpella would either duplicate that mapping or require `ACPELLA_AGENT` to be a full command (e.g. `npx @zed-industries/codex-acp`)

- Session recovery on daemon restart — keep `(no session)` fallback or auto-recreate?
- Agent crash handling — restart agent process and transparently resume, or surface error?
- Whether to keep `acpx` as a fallback/escape hatch during transition or cut it completely
