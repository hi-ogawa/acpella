# Per-Session Agent State Schema

## Problem Context And Approach

Backlog item: `feat: change agent per session`.

acpella currently starts with one configured ACP agent and stores session mappings under a top-level
scope keyed by `config.agent.command`:

```ts
{
  version: 1,
  scopes: {
    [agentCommand]: {
      sessions: {
        [sessionName]: {
          sessionId,
          verbose,
        },
      },
    },
  },
}
```

This avoids collisions between different agent commands, but it puts the agent selection outside the
messaging conversation record. That makes future per-session agent selection awkward because the
current agent is implied by the running process instead of being explicit state for each Telegram
chat/thread.

The schema discussion should stay focused on durable state shape and command semantics. Do not treat
this note as an implementation plan yet.

## Reference Files And Patterns

- `src/state.ts` owns the JSON state file schema and migration boundary.
- `src/handler.ts` currently creates one ACP manager from `config.agent.command` and keeps active
  sessions in `Map<sessionName, AgentSession>`.
- `src/config.ts` currently resolves `ACPELLA_AGENT` into `{ alias, command }`; this note discusses
  dropping that as the future agent-selection mechanism.
- `docs/architecture.md` describes acpella's intended boundary: Telegram/local routing is owned by
  acpella; deeper memory and resumability are owned by the selected ACP agent.
- `docs/todo.md` tracks `feat: change agent per session`.

## Terms

- `conversationKey`: acpella's messaging-side identity, currently the `sessionName` derived from the
  local REPL or Telegram chat/thread.
- `agentKey`: a stable acpella-local identifier for an available agent.
- `agentSessionId`: the session id returned by an ACP agent.
- `sessionKey`: an acpella-local identifier for a saved agent session, likely derived from
  `agentKey` and `agentSessionId`.

## Direction

Prefer separating conversations from agent sessions:

```ts
{
  version: 2,
  defaultAgent: string,
  agents: {
    [agentKey]: {
      command: string,
    },
  },
  conversations: {
    [conversationKey]: {
      sessionKey?: string,
      verbose?: boolean,
    },
  },
  sessions: {
    [sessionKey]: {
      agentKey: string,
      agentSessionId: string,
      // Deferred until there is a concrete command/use case:
      // conversationKey?: string,
      // createdAt?: string,
      // updatedAt?: string,
    },
  },
}
```

Important properties of this direction:

- Conversations store routing and acpella-owned preferences.
- Sessions store resumable ACP session references.
- Agent metadata is top-level so commands can validate and display available agents.
- A conversation points to its current agent session instead of owning all session records inline.
- `defaultAgent` is the fallback agent for conversations that do not have a `sessionKey` yet.
- Deferred fields should stay out of the schema until a command or behavior needs them.

Example:

```json
{
  "version": 2,
  "defaultAgent": "test",
  "agents": {
    "test": {
      "command": "node .../test-agent.ts"
    },
    "codex": {
      "command": "codex-acp"
    },
    "claude": {
      "command": "claude-acp"
    }
  },
  "conversations": {
    "tg--100-42": {
      "sessionKey": "codex:abc123",
      "verbose": false
    }
  },
  "sessions": {
    "codex:abc123": {
      "agentKey": "codex",
      "agentSessionId": "abc123"
    },
    "claude:xyz789": {
      "agentKey": "claude",
      "agentSessionId": "xyz789"
    }
  }
}
```

## Why Top-Level Sessions

Keeping `sessions` top-level avoids overloading `conversations` as both the messaging route and the
agent-session inventory.

Benefits:

- `/session load <agentKey:agentSessionId>` can resolve directly to one session record.
- `/session list` can show saved sessions without walking every conversation.
- Conversation preferences do not need to be copied onto every agent session.
- Future metadata can be added to session records later without moving nested records.

## Agent Key Discussion

The current persistent scope key is the raw agent command. That is brittle because a command can
change while still referring to the same conceptual agent.

Prefer a stable `agentKey`:

- Built-in agents can use their configured key, such as `test` or `codex`.
- Custom agents need an explicit stable key once per-session selection exists.
- `command` should be metadata, not the durable identity.

Drop `ACPELLA_AGENT` as the durable agent selection mechanism. Keep built-in agent definitions in
code, with `test` available by default. Runtime agent management can add more entries to `agents`.

If `agentKey` is already the user-facing stable name, the minimal schema does not need a separate
display-name field yet.

## Default Agent

Use a required top-level `defaultAgent: string`.

Initial/default state should use:

```ts
defaultAgent: "test";
```

Behavior:

- If a conversation has `sessionKey`, use that saved session.
- If a conversation has no `sessionKey`, create a new session using `defaultAgent`.
- If `defaultAgent` references a missing agent, state is invalid and should fail validation or be
  repaired deliberately.

This keeps first-message UX simple without reintroducing environment-driven routing. The routing
decision is either explicit per conversation through `conversation.sessionKey`, or explicit globally
through `defaultAgent`.

## Session Key Discussion

The simplest session key is:

```ts
`${agentKey}:${agentSessionId}`;
```

That matches the likely user-facing command syntax:

```text
/session load codex:abc123
```

Questions to settle:

- Can ACP session ids contain `:`?
- If yes, should parsing split only on the first colon?
- Should the state file use an encoded key internally while keeping `agentKey:agentSessionId` only as
  command syntax?
- Is there value in using generated UUID-like `sessionKey` values and storing
  `{ agentKey, agentSessionId }` only as fields?

## Conversation Preferences

`verbose` currently lives on the saved session entry. With top-level conversations, it probably
belongs on `conversations[conversationKey]` because it is an acpella display preference for a
Telegram chat/thread, not a property of the ACP session itself.

That implies:

- Switching from Codex to Claude in the same Telegram thread should preserve `/verbose off`.
- Loading a different ACP session should not unexpectedly reset display preferences.
- Closing or detaching an ACP session should not necessarily delete conversation preferences.

## Command Semantics To Design

The schema should support these session command shapes, but exact UX is undecided:

```text
/session
/session list
/session new
/session new <agentKey>
/session load <agentSessionId>
/session load <agentKey:agentSessionId>
/session close [sessionKey]
```

Compatibility idea:

- `/session load <agentSessionId>` keeps using the current/default agent.
- `/session load <agentKey:agentSessionId>` selects the specified agent and makes that session current
  for the conversation.

Open design point: should `/session new <agentKey>` create a fresh session and make it current, or
should agent selection be handled by a clearer command later?

## Agent Commands To Design

Candidate minimal command surface:

```text
/agent list
/agent new <name> <command>
/agent remove <name>
/agent default
/agent default <name>
```

`/agent list` should show the known agent keys and commands. This gives users a discoverable source
of valid names for commands such as `/session new <agentKey>` and
`/session load <agentKey:agentSessionId>`.

`/agent new <name> <command>` should create or update an agent definition. Treat `<name>` as the
stable `agentKey`, and treat `<command>` as the rest of the line so commands can include arguments:

```text
/agent new codex codex-acp
/agent new claude claude --some-flag
```

Because `<name>` is the stable key, the minimal agent schema does not need a separate display field:

```ts
agents: {
  [agentKey]: {
    command: string,
  },
}
```

`/agent remove <name>` should be conservative. Prefer refusing removal while saved sessions still
reference the agent, rather than cascading deletes or leaving orphaned session records. A later
iteration can add an explicit force/delete workflow if it becomes necessary.

`/agent default` should show the current default agent. `/agent default <name>` should set the
required top-level `defaultAgent` after validating that `<name>` exists in `agents`.

Refuse to remove the current default agent. The user should choose another default first.

Avoid adding `/agent use <name>` for the first pass. It sounds conversation-local, while
`/agent default <name>` is clearly the global fallback for new conversations. Session commands already
select the current conversation's agent indirectly by selecting or creating a session.

## Migration Sketch

Migration from v1 can be lossless enough:

```ts
for each [agentCommand, scope] in state.scopes:
  agentKey = deriveAgentKey(agentCommand)
  agents[agentKey] = { command: agentCommand }

  for each [conversationKey, entry] in scope.sessions:
    sessionKey = makeSessionKey({ agentKey, agentSessionId: entry.sessionId })

    sessions[sessionKey] = {
      agentKey,
      agentSessionId: entry.sessionId,
    }

    conversations[conversationKey] ??= {}
    conversations[conversationKey].verbose ??= entry.verbose
    conversations[conversationKey].sessionKey ??= sessionKey
```

If the same conversation appears under multiple old command scopes, keep all migrated sessions. Pick
the currently configured agent as `sessionKey` when possible; otherwise keep the first migrated
session as the conversation's current session.

Set `defaultAgent` during migration. Use `"test"` because it is the built-in default agent key.

## Open Questions

- Where should the authoritative list of available agents live: built-ins, state file, future JSON
  config, or some combination?
- Should state include only agents that have saved sessions, or all configured agents?
- Should `/agent new <name> <command>` overwrite an existing agent command, or require an explicit
  update command?
- Should closing a session delete the session record or only clear `conversations[conversationKey].sessionKey`?
- Which deferred fields are actually needed first: `conversationKey`, timestamps, labels, or archived
  status?
- How should active in-memory sessions be keyed once agents vary per conversation:
  `conversationKey`, `sessionKey`, or both?

## Non-Goals For This Note

- Do not implement the schema migration yet.
- Do not change `src/state.ts` yet.
- Do not design the full multi-agent process manager yet.
- Do not decide Telegram command copy beyond what is needed to evaluate the state shape.
