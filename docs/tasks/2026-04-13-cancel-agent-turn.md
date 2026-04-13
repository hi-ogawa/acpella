# Cancel In-Flight Agent Turn

## Problem Context And Approach

Issue: <https://github.com/hi-ogawa/acpella/issues/27>

acpella currently waits for each ACP prompt to finish before returning from the Telegram/REPL handler. If a prompt hangs or runs too long, the practical escape hatch is restarting `acpella.service`, which also stops the bridge and can cause Telegram update redelivery.

Add a local `/cancel` command that is handled by acpella and never forwarded to the agent. Track the active prompt per Telegram session name, try ACP-native `session/cancel` first, wait briefly for the prompt to settle, and kill the spawned agent process if it is still running.

## Reference Files And Patterns

- `src/handler.ts` routes local commands before normal prompts. `/status` and `/session ...` are the existing examples.
- `src/acp/index.ts` owns ACP child process lifecycle. It currently spawns one agent process per `newSession`, `loadSession`, `listSessions`, and `closeSession` call.
- `src/acp/index.ts` already has TODOs near `createSession.prompt` for single in-flight prompt and cancellation.
- `@agentclientprotocol/sdk` exposes `connection.cancel({ sessionId })`, which sends ACP `session/cancel`.
- `src/lib/test-agent.ts` is the minimal ACP test agent and can be extended with a slow prompt mode plus observable cancellation behavior.
- `src/e2e/basic.test.ts` and `src/e2e/helper.ts` provide REPL-style smoke coverage for user-visible command behavior.

## Implementation Plan

1. Extend the ACP session object returned by `createSession` with a `cancel()` method.
2. In `cancel()`, call `agent.connection.cancel({ sessionId })`, wait for the active prompt promise to settle for a short timeout, then kill `agent.child` if needed.
3. Make `prompt()` remember the current prompt promise and clear it in `finally`.
4. In `createHandler`, add an `activeTurns` map keyed by Telegram session name. Store the session while `handlePrompt` is running and remove it in `finally`.
5. Handle exact `/cancel` before `/session` and normal prompt routing.
6. Return:
   - `No active agent turn.` when no matching active turn exists.
   - `Cancelled current agent turn.` when ACP cancellation settles the prompt.
   - `Cancelled current agent turn by killing the agent process.` when fallback killing is needed.
7. Avoid forwarding `/cancel` into `handlePrompt`.
8. Add tests:
   - ACP unit test for native cancel settling a slow prompt.
   - ACP unit test or e2e test for fallback process kill when the agent ignores cancel.
   - E2E/handler coverage that `/cancel` with no active prompt reports clearly and is not echoed by the agent.
9. Run `pnpm test` and `pnpm lint`.

## Initial Scope Notes

- Track only one active prompt per Telegram session name. Broader queueing/concurrency behavior remains a separate backlog item.
- Telegram update dedupe/redelivery is explicitly out of scope for this issue.
- Keep command matching conservative for the first pass: exact `/cancel`, with `/interrupt` left for a follow-up unless needed.
