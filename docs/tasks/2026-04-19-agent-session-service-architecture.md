# Agent Session Service Architecture Rework

## Problem Context And Approach

Cron MVP work introduced a pragmatic dependency shape where `handler.ts` exposes `promptSession(...)` so `CronRunner` can run scheduled prompts through the same ACP session path as live user messages. This works for the MVP, but it makes `handler` more than an inbound command/message adapter.

The architectural smell is a cycle in responsibility:

- `handler` wants a cron refresh hook so future `/cron add`, `/cron enable`, `/cron disable`, and `/cron delete` commands can update the running scheduler after successful store mutations.
- `cron runner` wants agent prompt execution, currently exposed through `handler.promptSession(...)`.

The fundamental fix is to move agent session execution out of `handler` into a shared application service. `handler` and `cron runner` should be peers that both depend on shared lower-level capabilities. `cli.ts` should remain the composition root that creates concrete services and wires them together.

This rework is intentionally outside the cron MVP. The MVP can keep the temporary shape as long as the dependency direction remains easy to replace.

## Reference Files And Patterns To Follow

- `src/handler.ts`
  - Currently owns system command routing, normal prompt handling, active session tracking, cancellation, session state updates, and the temporary `promptSession(...)` method.
  - This file should eventually shrink toward command/message routing and reply streaming.
- `src/cron/runner.ts`
  - Schedules due jobs and calls an injected agent prompt function plus injected delivery function.
  - Its injected `agent.promptSession(...)` should eventually come from the shared agent session service, not from `handler`.
- `src/cli.ts`
  - Composition root for config, stores, handler, bot, and cron runner.
  - This is the right place to create the shared agent session service and pass it to both `handler` and `cron runner`.
- `src/acp/index.ts`
  - ACP adapter layer. `AgentManager` is the lower-level process/session adapter, not the place for Telegram or cron policy.
- `src/state.ts`
  - Owns durable session state. A future agent session service should use this store rather than duplicating state logic.

## Desired Dependency Shape

Keep the architecture understandable with only these five high-level entities:

```text
                    cli
                     |
        creates and wires everything
                     |
     +---------------+---------------+
     |               |               |
    bot          handler        cron runner
     |               |               |
     |               |               |
     v               v               v
 Telegram      user/system       scheduled
 updates       command flow      cron flow
                     |               |
                     +-------+-------+
                             |
                             v
                      agent manager
```

Ideal dependency direction:

```text
cli
├─ bot
├─ handler
├─ cron runner
└─ agent manager

bot ─────────────> handler
handler ─────────> agent manager
cron runner ─────> agent manager
```

There should be no direct dependency between:

```text
handler <──> cron runner
```

Conceptual rule:

```text
handler and cron runner are peers.
agent manager is the shared lower-level capability.
cli is the only place that knows how to connect them.
```

In implementation, the "agent manager" box may be a new `AgentSessionService` that wraps `AgentManager`, `SessionStateStore`, active turn tracking, cancellation, first-prompt insertion, and prompt streaming.

## Target Responsibilities

### Agent Manager / Agent Session Service

- Own active session tracking and cancellation.
- Load or create ACP sessions.
- Apply first-prompt behavior for new sessions.
- Append message metadata when provided.
- Stream agent text chunks to a caller callback.
- Expose a collect-to-string prompt path for scheduled work.
- Use `SessionStateStore` for durable session state.
- Create/use `AgentManager` instances for configured agents.
- Know nothing about Telegram, bot command registration, cron command text, or scheduler lifecycle.

### Handler

- Parse and route inbound system commands.
- Convert normal inbound user messages into calls to the agent session service.
- Stream chunks into `Reply`.
- Use cron command/application APIs for `/cron ...`.
- Not own `activeSessions`.
- Not expose `promptSession(...)` as a general application service.
- Not be called by `CronRunner`.

### Cron Runner

- Own scheduler runtime mechanics.
- Read enabled jobs from the cron store or cron service.
- On due event, build cron trigger prompt metadata.
- Call the shared agent session service to execute the prompt.
- Call injected delivery to send proactive output.
- Not call `handler`.

### Bot

- Own Telegram-specific inbound and outbound translation.
- Convert Telegram updates into `HandlerContext`.
- Register bot commands from handler metadata.
- Provide proactive delivery implementation used by `CronRunner`.
- Not know ACP session internals.

### CLI

- Load config and version.
- Create stores and services.
- Create handler, bot, and cron runner.
- Wire refresh/control hooks.
- Start and stop service lifecycles.
- Be the only module that knows the full object graph.

## Implementation Plan

1. Introduce an agent session service module, likely `src/acp/session-service.ts` or `src/session/agent-service.ts`.
   - Move `activeSessions`, `cancelledSessions`, `getAgentManager`, and the shared prompt execution logic out of `handler.ts`.
   - Keep the public API small:
     - `prompt(...)` for streaming chunks and tool-call notifications.
     - `promptText(...)` or `promptSession(...)` for collecting assistant text.
     - `cancel(sessionName)`.
     - session helpers needed by `/session ...` commands, or leave those in handler if they remain simple store operations.

2. Update `handler.ts` to depend on the new service.
   - Normal messages call service prompt streaming.
   - `/cancel` calls service cancellation.
   - Verbose tool-call behavior can remain session-state-backed, but the streaming callback should receive enough event data for handler formatting.

3. Update `cron runner` construction to use the new service directly.
   - `cli.ts` should pass `agentSessionService.promptText` into `CronRunner`.
   - Remove `handler.promptSession(...)`.

4. Decide where cron mutation commands live.
   - Pragmatic option: keep command definitions in `handler.ts` and inject `cronRunner.refresh()`.
   - Cleaner option: create a cron command/application service that owns cron mutations and refresh control, while `handler` only routes text and renders replies.

5. Keep `cli.ts` as composition root.
   - Create `SessionStateStore`, `CronStore`, agent session service, handler, bot, and cron runner there.
   - Avoid new global singletons.

6. Preserve behavior while moving code.
   - Normal prompt output should remain unchanged.
   - `/cancel` should still cancel the active turn for a session.
   - `/session new` should still create a fresh ACP session and send an empty prompt.
   - Cron scheduled prompts should still be blocked by the same active-session guard as live prompts.

## Non-Goals

- Do not redesign cron persistence as part of this rework.
- Do not change Telegram formatting or reply splitting behavior.
- Do not introduce event buses or framework-level dependency injection unless there is a concrete need.
- Do not make multi-process cron scheduling guarantees.
