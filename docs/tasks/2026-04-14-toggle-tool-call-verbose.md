# Toggle Tool Call Verbosity

## Problem Context And Approach

Backlog item: `feat: toggle tool call in response`.

acpella currently emits ACP `tool_call` updates into the user-facing reply as `Tool: <title>` from `src/handler.ts`. That is useful for visibility, but users need a session-scoped toggle so they can hide tool-call noise without changing the agent or losing normal assistant text.

MVP behavior:

- Tool-call responses are visible by default.
- The setting persists in `stateFile` per acpella session name.
- Local system commands are handled by acpella and are not sent to the agent:
  - `/verbose` reports current status and help.
  - `/verbose on` enables tool-call responses.
  - `/verbose off` disables tool-call responses.

Implementation should keep the feature local to the messaging/router layer. ACP sessions still receive all updates; acpella only decides whether `tool_call` updates are written into the outgoing reply.

## Reference Files And Patterns

- `src/handler.ts` routes local commands before normal prompts. Existing command examples are `/status`, `/cancel`, `/service ...`, and `/session ...`.
- `src/handler.ts` currently handles `tool_call` updates inside `handlePrompt` by flushing pending assistant text, writing `Tool: ${update.title}`, and flushing again.
- `src/state.ts` owns the JSON `stateFile`. It is scoped by `config.agent.command`, then by acpella session name.
- `src/state.ts` currently stores only `{ sessionId }` for each session. Its narrow `getSessionId()` / `setSessionId()` API should be replaced with `getSession()` / `setSession()` so session-id persistence and preferences share one entry-level API.
- `src/handler.test.ts` covers handler-level command behavior and inline snapshots for user-visible replies.
- `src/lib/test-agent.ts` is the built-in ACP test agent. It can be extended with a prompt trigger that emits a synthetic `tool_call` update before the echoed assistant text.

## State Shape

Extend the existing per-session entry rather than adding a separate top-level map:

```ts
sessions: {
  [sessionName: string]: {
    sessionId?: string;
    verbose?: boolean;
  };
}
```

Interpret `verbose === undefined` as `true` to preserve the default-on behavior and avoid requiring a migration for existing state files.

Important follow-up edits caused by optional `sessionId`:

- Replace `getSessionId(sessionName)` with `getSession(sessionName)`, returning the full entry or `undefined`.
- Replace `setSessionId(sessionName, sessionId)` with `setSession(sessionName, patch)`, merging with the existing entry instead of overwriting it.
- Existing call sites should read `state.getSession(name)?.sessionId`.
- Session-id writes should become `state.setSession(name, { sessionId })`, preserving `verbose`.
- Verbose writes should become `state.setSession(name, { verbose })`, preserving `sessionId`.
- `deleteSession(sessionName)` needs a decision:
  - Preferred MVP: remove only `sessionId` and preserve `verbose`, because `/session close` should not unexpectedly reset display preferences.
  - If the resulting entry has neither `sessionId` nor non-default preferences, it can be deleted to keep the file small.
- `handleListSessions()` should ignore state entries that have no `sessionId`, otherwise preference-only entries would render as broken session mappings.

Keep `version: 1` unless a stronger migration policy is added at the same time. The schema can be made backward-compatible by changing only the session entry object.

## Implementation Plan

1. Update `src/state.ts` schema and store API.
   - Add optional `verbose: z.boolean().optional()` to each session entry.
   - Make `sessionId` optional in the schema.
   - Replace `getSessionId(sessionName)` with `getSession(sessionName)`, returning `Scope["sessions"][string] | undefined`.
   - Replace `setSessionId(sessionName, sessionId)` with `setSession(sessionName, patch)`, merging the patch with any existing entry.
   - Avoid adding separate `getVerbose()` / `setVerbose()` methods; derive verbose behavior from `state.getSession(name)?.verbose ?? true` and write it with `state.setSession(name, { verbose })`.
   - Change `deleteSession()` to clear the `sessionId` while preserving a non-default `verbose: false` preference; remove the entry only when it has no useful data left.

2. Gate tool-call reply output in `src/handler.ts`.
   - Read the setting at the start of `handlePrompt`, for example `const verbose = state.getSession(options.name)?.verbose ?? true`.
   - Keep console logging of ACP update types unchanged.
   - For `tool_call` updates:
     - If verbose is enabled, preserve current behavior: flush text, write `Tool: ${update.title}`, flush.
     - If verbose is disabled, do not write anything to the user reply for that update.

3. Add a local verbose command handler in `src/handler.ts`.
   - Parse the exact system command forms from the MVP scope: `/verbose`, `/verbose on`, `/verbose off`.
   - Route it before `handlePrompt()` so those messages are never sent to the agent.
   - `/verbose` response should include current status plus help, e.g.
     - `verbose: on`
     - `Usage: /verbose [on|off]`
   - `/verbose on` response should confirm `verbose: on`.
   - `/verbose off` response should confirm `verbose: off`.
   - For unknown arguments, return the same status/help response instead of forwarding to the agent.

4. Extend tests.
   - Add handler coverage that `/verbose` reports default `on`.
   - Add handler coverage that `/verbose off` persists in `stateFile` and `/verbose` reports `off` for the same acpella session.
   - Add handler coverage that another acpella session still defaults to `on`.
   - Add regression coverage that saving/loading an ACP `sessionId` does not erase `verbose: false`.
   - Add regression coverage for the new `getSession()` / `setSession()` merge behavior.
   - Extend `src/lib/test-agent.ts` with a deterministic prompt trigger such as `__tool:<title>` that emits a `tool_call` update plus normal assistant text.
   - Test that tool-call text is included by default and after `/verbose on`.
   - Test that tool-call text is omitted after `/verbose off` while normal assistant text is still returned.

## Out Of Scope For MVP

- Hiding other ACP update types besides `tool_call`.
- Per-agent or global default configuration.
- Formatting richer tool-call details beyond the existing title.
- Changing ACP agent behavior or tool execution.
- Telegram bot command registration for `/verbose`.
