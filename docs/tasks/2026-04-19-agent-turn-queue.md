# Agent Turn Queue

## Problem Context And Approach

Cron support adds a second caller for agent prompts. Live user messages enter through `handler.handle(...)`, while scheduled jobs enter through the cron runner and call the handler-level prompt API. Both paths can target the same logical acpella session.

Today `handler.ts` uses `activeSessions` as a guard:

```ts
if (activeSessions.has(sessionName)) {
  throw new Error("Agent turn in progress. Cannot run cron prompt.");
}
```

That guard is not a true serialization boundary. `activeSessions` is set only after session load/create work and after `session.prompt(...)` is called, so two concurrent callers can both pass the guard before either caller records the active session. Telegram request handling mostly avoids this by serializing updates, but cron makes concurrency possible inside the application itself.

The canonical fix is to make agent prompt execution per-session serialized in the application core, independent of the inbound surface. The smallest useful step is a keyed promise queue around prompt turns. A later architecture rework can move that queue into a dedicated agent session service.

The core invariant should be:

```text
No code path calls ACP session.prompt() for a sessionName unless it is inside that sessionName's turn queue.
```

## Reference Files And Patterns To Follow

- `src/handler.ts`
  - Currently owns normal prompt handling, cron prompt handling, `activeSessions`, `cancelledSessions`, `/cancel`, and session state updates.
  - The first queue integration can stay in this file to keep the change local.
- `src/cron/runner.ts`
  - Calls an injected agent prompt function for scheduled jobs.
  - Cron should be allowed to wait behind an active turn rather than fail immediately.
- `src/lib/async-queue.ts`
  - Existing small async primitive style.
  - A keyed promise queue should be similarly small and dependency-free.
- `docs/tasks/2026-04-19-agent-session-service-architecture.md`
  - Longer-term extraction plan.
  - The turn queue is a practical precursor to that service, not a replacement for the whole rework.
- `src/handler.test.ts`
  - Existing handler-level cron tests exercise scheduled prompt execution and failure delivery.
  - Queue behavior should be testable at this level without introducing Telegram-specific assumptions.

## Desired Behavior

Prompt execution should be serialized per `sessionName`, not globally.

Two different sessions may run concurrently:

```text
session A prompt
session B prompt
```

Two turns for the same session must not overlap:

```text
session A prompt 1
session A prompt 2 waits until prompt 1 completes
```

Cron turns should queue behind active turns for the same session. This avoids losing scheduled work just because a user turn is currently running.

Interactive user turns can either queue or preserve the current user-facing behavior:

```text
Agent turn already in progress. Send /cancel to stop it.
```

The pragmatic first policy is:

- User prompt while same session is busy: keep current rejection message.
- Cron prompt while same session is busy: queue and run when the active turn completes.
- `/cancel`: cancel only the currently active turn, not queued turns.

This keeps interactive UX predictable while making cron reliable.

## Proposed Utility

Add a small keyed promise queue utility, likely under `src/lib/keyed-promise-queue.ts`.

Suggested API:

```ts
export class KeyedPromiseQueue {
  isBusy(key: string): boolean;
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}
```

Expected semantics:

- Calls with the same key run one at a time in call order.
- Calls with different keys run independently.
- A rejected task rejects only that caller and does not poison later queued tasks.
- Once the queue for a key drains, the key is removed from internal maps.
- `isBusy(key)` returns true while a task is active or queued for that key.

Implementation can use a per-key promise tail:

```text
previous tail
  -> current task
  -> cleanup if current task is still latest tail
```

The implementation must swallow the previous tail rejection before starting the next task so one failed prompt does not block the queue forever.

## Handler Integration Plan

1. Create one `KeyedPromiseQueue` instance in `createHandler`.

2. Route all actual prompt execution through a helper:

   ```ts
   async function runPromptTurn(options) {
     return promptQueue.run(options.sessionName, () => handlePromptImpl(options));
   }
   ```

3. Update normal prompt handling:
   - Replace `activeSessions.has(sessionName)` as the primary concurrency guard with `promptQueue.isBusy(sessionName)`.
   - Keep the current system message for user prompts when busy.
   - Call `runPromptTurn(...)` instead of `handlePromptImpl(...)` directly.

4. Update cron prompt handling:
   - Remove the preflight `activeSessions.has(sessionName)` rejection.
   - Call `runPromptTurn(...)`.
   - Collect chunks as today.
   - If the queued turn is cancelled, reject with `"Agent turn cancelled."` as today.

5. Keep `activeSessions` and `cancelledSessions` initially:
   - `activeSessions` still serves `/cancel`.
   - `cancelledSessions` still records cancellation result for the active `AgentSessionProcess`.
   - Writes to `activeSessions` should happen only inside queued execution.
   - `/cancel` may read `activeSessions` from outside the queue to cancel the currently active turn.

6. Do not change cron persistence, cron delivery, or command formatting as part of this task.

## Later Agent Session Service Shape

The queue utility is the local fix. The cleaner architecture is to move queue ownership, active session tracking, cancellation, first-prompt insertion, and ACP session load/create behavior into an agent session service.

Target shape:

```text
bot/repl
  -> handler
      -> agent turn service

cron runner
  -> agent turn service

agent turn service
  -> keyed promise queue
  -> SessionStateStore
  -> AgentManager
```

Possible API:

```ts
type AgentTurnRequest = {
  sessionName: string;
  text: string;
  onText: (text: string) => Promise<void> | void;
  onToolCall?: (title: string, stateSession: StateSession) => Promise<void> | void;
};

class AgentTurnService {
  isBusy(sessionName: string): boolean;
  prompt(request: AgentTurnRequest): Promise<{ cancelled: boolean }>;
  promptText(options: { sessionName: string; text: string }): Promise<string>;
  cancel(sessionName: string): Promise<CancelResult>;
}
```

That later service should be used by both `handler` and `cron runner`, with `cli.ts` as the composition root.

## Testing Plan

Start with focused unit coverage for the queue utility:

- Same-key tasks run in order.
- Different-key tasks can run concurrently.
- A rejected task does not prevent a later same-key task from running.
- `isBusy` reflects active and queued work, then clears after drain.

Then add handler-level coverage:

- Cron prompt waits behind an active prompt for the same session.
- A queued cron prompt still records/delivers success after the first prompt completes.
- A queued cron prompt failure still records failure and delivers the failure notification.
- User prompt while busy keeps the existing system response if that policy is preserved.
- `/cancel` cancels only the active turn; queued cron behavior can remain unspecified until queue cancellation exists.

## Non-Goals

- Do not implement queue cancellation for pending turns in the first pass.
- Do not redesign `/cancel` semantics beyond preserving current active-turn behavior.
- Do not change Telegram runner concurrency settings.
- Do not move all agent session code out of `handler.ts` in this task.
- Do not make cron scheduling multi-process safe.
