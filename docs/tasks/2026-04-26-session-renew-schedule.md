# Session Renew Schedule

## Problem Context And Approach

Issue context: <https://github.com/hi-ogawa/acpella/issues/101>

The issue asks for "something like openclaw's default per-day session renewal." OpenClaw's documented default is a daily reset at 4:00 AM local time: a conversation keeps using its current session until it crosses the reset boundary, then the next message starts a fresh session.

acpella currently has only explicit renewal:

- if a conversation has no saved `agentSessionId`, the next prompt creates a new ACP session
- `/session new [agent]` clears the saved `agentSessionId`
- `/session load ...` points the conversation at an existing ACP session
- otherwise, acpella keeps reusing the saved ACP session indefinitely

That makes long-running Telegram, REPL, and cron workflows accumulate context forever unless the operator remembers to run `/session new`. It also means changes to `.acpella/AGENTS.md` only reach a conversation after manual renewal.

The feature should add a lightweight acpella-owned renewal policy around the existing session mapping. The agent still owns deep memory, tools, and transcript state. acpella only decides when a conversation should stop reusing one ACP session id and create a fresh one.

## Feature Intent

Session renewal should be predictable, lazy, and conversation-scoped.

Predictable means the renewal boundary is based on the configured acpella timezone and a simple policy, initially daily at a configured local hour. If the policy is "daily at 4", a session last used before the most recent 4:00 AM boundary is stale after that boundary.

Lazy means acpella does not proactively create sessions on a timer. Renewal happens immediately before the next prompt for that conversation, including normal Telegram prompts, REPL prompts, and scheduled cron prompts. If no one talks to the conversation, no new ACP session is created.

Conversation-scoped means renewal applies to the acpella session name, not globally to the agent. One Telegram chat/thread can renew while another chat/thread keeps its current ACP session until its own next prompt.

## Desired Behavior

When acpella is about to send a user or cron prompt to an ACP agent:

1. load the current state entry for the acpella session name,
2. decide whether the saved `agentSessionId` is stale under the configured renewal policy,
3. if it is still fresh, load the saved ACP session as today,
4. if it is stale, create a new ACP session, persist the new `agentSessionId`, and send the normal first-prompt initialization before the user or cron prompt,
5. update session activity metadata so the next renewal decision has a stable timestamp.

Manual session commands should keep their current mental model:

- `/session new [agent]` still forces the next prompt into a fresh ACP session immediately.
- `/session load <sessionId|agent:sessionId>` still binds the conversation to that ACP session. Loading should make the session fresh from acpella's perspective unless we decide to expose an explicit "load old but renew on next boundary" variant later.
- `/session close ...` still closes/removes a mapping explicitly.
- `/session info [sessionName]` should show enough renewal metadata to explain why a session will or will not renew soon.
- `/session renew <value> [sessionName]` sets the compact per-session renewal policy, similar to `/session verbose on|off [sessionName]`.

Cron behavior should follow the same policy as live prompts. A recurring daily cron job bound to a persistent acpella session should usually get one fresh ACP session per renewal period, not one fresh ACP session per cron run. This preserves useful same-day continuity while preventing unbounded multi-day context growth.

## Proposed MVP Policy

Start with a compact per-session renewal policy:

- `off`
- `daily`
- `daily:<hour>`

The policy lives on the acpella session entry, next to `verbose`. This is intentionally per-session-name because different conversations can reasonably want different lifecycle behavior. For example, a normal daily assistant chat may want OpenClaw-style daily renewal, while a long-running project session or cron workflow may want to stay pinned until explicitly reset.

Semantics:

- `undefined`: use the default renewal policy
- `off`: never auto-renew
- `daily`: renew daily at the default hour
- `daily:<hour>`: renew daily at that local hour, where hour is an integer `0` through `23`

Use the existing `config.timezone` for daily boundaries.

Default policy is the main product decision to settle before implementation:

- Option A: default `daily`, with default hour `4`, matching OpenClaw's current documented default.
- Option B: default `off` for backward compatibility, with docs showing how to opt into OpenClaw-like daily renewal per session.

Leaning recommendation: default to `daily` at 4:00 AM for new behavior, because the issue explicitly asks for OpenClaw-like default per-day renewal and acpella is still early. If this feels too surprising for existing users, make the default `off` and call out the tradeoff in README and `skills/acpella`.

Idle-based renewal is useful but should be deferred unless it falls out naturally. Daily renewal is the narrow issue.

Session command management should mirror the compact policy:

```text
/session renew off [sessionName]
/session renew daily [sessionName]
/session renew daily:<hour> [sessionName]
```

There is no read-only `/session renew` form. `/session info [sessionName]` reports the effective renewal policy, matching how `verbose` status is reported.

## State Model

The current state entry has:

```ts
{
  agentKey: string;
  agentSessionId?: string;
  verbose?: boolean;
}
```

Renewal needs durable activity metadata. A minimal extension is:

```ts
{
  agentKey: string;
  agentSessionId?: string;
  verbose?: boolean;
  renew?: "off" | "daily" | `daily:${number}`;
  updatedAt?: number;
}
```

`updatedAt` should mean "the last time acpella considered this conversation's current ACP session active." It should update when a prompt is accepted for execution, not only when the agent finishes, so a long or failed turn does not leave obviously stale metadata.

The `renew` string should be validated, not parsed ad hoc throughout the codebase. A helper can normalize it into an effective policy object internally:

```ts
type EffectiveRenewPolicy = { mode: "off" } | { mode: "daily"; atHour: number };
```

This keeps persisted state compact while keeping the implementation type-safe.

Existing state entries without `updatedAt` need a compatibility rule. Reasonable MVP behavior:

- if an entry has no `updatedAt`, treat it as fresh on first observation and write `updatedAt = now`
- do not unexpectedly renew every existing persisted session immediately after upgrade

That avoids a surprising fleet-wide reset on first startup after installing the feature.

## Renewal Decision

For daily mode, compute the most recent renewal boundary in `config.timezone` for the configured hour. A saved session is stale when:

- it has an `agentSessionId`, and
- it has an `updatedAt`, and
- `updatedAt` is earlier than the most recent boundary.

Examples with boundary hour `4`:

- Now is 2026-04-26 03:00 local. The most recent boundary is 2026-04-25 04:00. A session updated at 2026-04-25 05:00 is fresh.
- Now is 2026-04-26 05:00 local. The most recent boundary is 2026-04-26 04:00. A session updated at 2026-04-26 03:30 is stale.
- Now is 2026-04-26 05:00 local. A session updated at 2026-04-26 04:01 is fresh.

The renewal check should run inside the same per-session prompt lane that currently serializes normal and cron prompts. That prevents two simultaneous prompts from both deciding to renew the same session.

## User-Facing Behavior

The first visible effect should be simple: after the renewal boundary, the next prompt behaves like it is the first prompt in a fresh ACP session.

Useful status output for `/session info`:

```text
session: tg-123
agent: codex
agent session id: abc123
verbose: off
renew: daily at 04:00 Asia/Tokyo
last active: 2026-04-26 01:23 Asia/Tokyo
next renew boundary: 2026-04-26 04:00 Asia/Tokyo
```

If the session is currently stale but has not yet received another prompt, either of these is acceptable:

- show `renew: stale, will renew on next prompt`
- or keep `/session info` non-mutating and merely show the last active and boundary information

Leaning recommendation: keep `/session info` non-mutating.

## Reference Files And Patterns To Follow

- `src/handler.ts`
  - owns the current prompt path, prompt lane serialization, `/session new`, `/session load`, `/session close`, and `/session info`
  - currently creates a new ACP session when `stateSession.agentSessionId` is absent
- `src/state.ts`
  - owns `.acpella/state.json` schema and session entries
  - likely place to add `updatedAt` and helpers for activity updates
- `src/config.ts`
  - owns env-backed app config and timezone
  - likely place for only the default renewal policy/hour if we want a deployment-wide fallback knob
- `src/handler.test.ts`
  - has session command coverage and cron prompt coverage
  - should get the main renewal behavior tests
- `skills/acpella/references/sessions-and-agents.md`
  - operator-facing session workflow docs
- `README.md`
  - config table should be updated only if new default-policy env variables are added

OpenClaw reference points:

- `refs/openclaw/docs/concepts/session.md`
  - documents daily reset default at 4:00 AM local time
- `refs/openclaw/src/auto-reply/reply/session.test.ts`
  - includes edge cases for daily reset boundaries

## Implementation Plan

1. Add renewal defaults.
   - Decide the default policy and default daily hour.
   - Use existing `config.timezone`.

2. Extend session state.
   - Add optional `updatedAt`.
   - Add optional compact `renew` string.
   - Validate `renew` as `off`, `daily`, or `daily:<0-23>`.
   - Add store helpers to update session activity without disturbing `agentKey`, `agentSessionId`, or `verbose`.
   - Preserve backward compatibility for existing state files.

3. Add renewal decision helpers.
   - Resolve a session's compact `renew` string plus defaults into an effective policy.
   - Compute the most recent daily boundary in a named timezone.
   - Decide stale/fresh without mutating state.
   - Keep timezone math centralized and unit-tested.

4. Integrate renewal into the prompt path.
   - Run the check after entering the per-session prompt lane and before loading the ACP session.
   - If stale, create a new ACP session and run the existing first-prompt initialization.
   - Do not interrupt an already-running prompt if the boundary passes mid-turn.

5. Update session commands.
   - `/session info` should render renewal metadata.
   - Add `/session renew off [sessionName]`, `/session renew daily [sessionName]`, and `/session renew daily:<hour> [sessionName]`.
   - `/session new` and `/session load` should set activity metadata consistently.

6. Add tests.
   - Fresh same-day session reuses the saved ACP session.
   - Session updated before the latest daily boundary renews on next prompt.
   - Session updated after the latest daily boundary does not renew.
   - Missing `updatedAt` does not immediately renew an existing saved session.
   - Per-session `renew: off` disables renewal even when the default is daily.
   - Per-session `renew: daily:<hour>` uses that hour instead of the default hour.
   - Cron prompt path uses the same renewal policy.
   - `/session renew <value> [sessionName]` mutates compact policy correctly.
   - `/session info` reports renewal policy and activity metadata without mutating the session.

7. Update docs.
   - README config table only if config gets new env-backed defaults.
   - `skills/acpella/references/sessions-and-agents.md` for operator behavior.
   - Possibly `docs/architecture.md` if the conversation model paragraph should mention automatic renewal.

## Non-Goals

- Do not add proactive timer-based session creation.
- Do not add idle renewal unless explicitly pulled into scope.
- Do not close or delete old ACP sessions automatically in the MVP.
- Do not redesign the state schema around separate conversation/session inventories.
- Do not change cron job persistence or scheduling semantics.
- Do not make renewal agent-specific in the MVP.

## Open Questions

- Should the default be OpenClaw-compatible daily renewal, or backward-compatible `off`?
- Should the default policy/hour be hard-coded initially, or configurable through env?
- Should `/session info` mark stale sessions explicitly, or only show timestamps?
- Should automatic renewal log a system-visible note, or stay silent unless the user asks for session info?
- If `/session load` attaches an old session before the current daily boundary, should it be considered fresh immediately, or should its original age matter if available?
