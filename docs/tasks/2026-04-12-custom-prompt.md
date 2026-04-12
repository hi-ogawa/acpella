# Custom Prompt

## Problem Context

acpella currently relies on the selected ACP agent to discover repo-local instructions such as
`AGENTS.md`. That keeps acpella agent-agnostic, but it does not give the bridge owner a simple place
to add personal or deployment-specific instructions that should apply to Telegram prompts.

The goal is to support an acpella-level custom prompt in addition to agent-owned instruction
discovery. This should not replace `AGENTS.md`, should not mutate repository files, and should not
depend on Codex-only behavior.

## Reference Files

- `src/config.ts` owns config loading and is the only module that reads `process.env`.
- `src/handler.ts` receives Telegram text, loads/creates an ACP session, and calls `session.prompt`.
- `src/acp/index.ts` turns a text string into ACP `session/prompt` content blocks.
- `docs/tasks/2026-04-12-config-mechanism.md` sketches the broader config-file direction.
- `src/e2e/codex/basic.test.ts` verifies that Codex still discovers `AGENTS.md` from `home`.

## ACP Constraints

ACP `session/new` does not expose a portable system-prompt field. ACP `session/prompt` sends user
content blocks. The `_meta` field is reserved for extensibility, but implementations must not depend
on semantic behavior from `_meta`, so it is not a good fit for user-visible custom instructions.

Because of that, the portable implementation is to send the custom prompt through ACP
`session/prompt` as an initialization turn:

```text
<acpella_custom_instructions>
...
</acpella_custom_instructions>
```

## Approach

- Treat custom prompt as an acpella user preference, not a higher-priority system instruction.
- Use `ACPELLA_PROMPT_FILE` as the only MVP configuration surface.
- Make the wording explicitly defer to higher-priority system, developer, repository, and security
  instructions.
- Keep repo instruction discovery untouched by continuing to pass `home` as the ACP session `cwd`.
- Keep any Telegram command layer optional and separate from the first implementation.

## Config Shape

Environment-only MVP:

```bash
ACPELLA_PROMPT_FILE=/home/hiroshi/.config/acpella/prompt.md
```

When `ACPELLA_PROMPT_FILE` is unset, acpella sends Telegram text unchanged.

When it is set, load the file once at startup. Fail fast if the file cannot be read, so a typo does
not silently run the daemon without the expected instructions.

Relative paths resolve against `home`, because it is the agent working directory and the place where
related acpella state lives.

## Prompt Injection Timing

Decision: send the custom prompt once when creating a new session.

### Option A: prepend every user turn

Pros:

- Works for new sessions and loaded sessions without knowing what prior context contains.
- Agent-agnostic because it only uses ACP `session/prompt`.
- Survives agent context compaction better because the instruction is always in the current turn.
- Makes prompt file edits take effect on the next message after daemon restart.

Cons:

- Re-sends the same text every turn, increasing token use.
- The instruction is user-message content, so it may be less authoritative than native agent
  instructions.
- Long custom prompts can crowd out the actual Telegram message on small-context agents.

### Option B: send once when creating a new session

Pros:

- Lower token use after the first turn.
- Keeps later Telegram messages cleaner.
- More closely matches the user's mental model of an extra session instruction.

Cons:

- Loaded sessions may not have received the current prompt file.
- Prompt changes apply only after creating a new session.
- Still not a real system prompt; it is just an earlier user message.

Mitigations:

- Inject only immediately after `manager.newSession`, before saving the session as ready.
- Use `/session new` as the explicit refresh path. A newly created session automatically receives the
  currently loaded prompt file before the next user request.

### Option C: agent-specific system prompt support

Pros:

- Potentially stronger instruction priority for agents that support it.
- Avoids repeating the prompt in every user message.

Cons:

- Not portable ACP behavior.
- Requires per-agent adapters and fallback behavior.
- Risks hiding important behavior differences between Codex, Claude, and test agents.

Chosen MVP: Option B. This avoids repeating the custom prompt on every Telegram message while
remaining agent-agnostic. The tradeoff is that prompt changes apply cleanly only to newly created
sessions.

## Initialization Prompt Wrapper

Recommended wrapper:

```text
Additional user preferences for this acpella bridge. Follow these unless they conflict with
higher-priority system, developer, repository, or security instructions.

<acpella_custom_instructions>
{customPrompt}
</acpella_custom_instructions>
```

Do not call it a system prompt in user-facing docs unless the implementation becomes agent-specific
and actually uses an agent system-prompt mechanism.

The wrapper can ask the agent to acknowledge the instruction tersely:

```text
Record these preferences for this session. Do not summarize them. Reply only with "OK".
```

The acknowledgement is returned as normal command output for `/session new`. For implicit session
creation before the first user message, acpella runs the initialization turn first, then runs the
user's message as the next turn.

## Session Behavior

When a new session is created and `ACPELLA_PROMPT_FILE` is configured, acpella should send the
initialization prompt before marking the session ready. This applies both to implicit session
creation on the first message and explicit `/session new`.

Existing loaded sessions are left unchanged. If the prompt file changes, the operational workflow is:

1. Restart acpella so the updated prompt file is loaded.
2. Run `/session new` in the Telegram chat/thread that should use the new prompt.
3. Continue chatting; the fresh session has already received the initialization prompt.

No prompt hash or prompt-version state is needed for the MVP.

## Implementation Plan

1. Add prompt config to `AppConfig`, for example `prompt: { file?: string; text?: string }`.
2. Add `ACPELLA_PROMPT_FILE` parsing in `src/config.ts`.
3. Resolve `ACPELLA_PROMPT_FILE` relative to `home` and document the rule.
4. Load the prompt file once at startup and fail fast if the configured file cannot be read.
5. Add a helper such as `formatInitializationPrompt({ customPrompt })`.
6. When `handlePrompt` creates a new session and a custom prompt is configured, send the
   initialization prompt first.
7. Update `/session new` so explicit new sessions also run the same initialization prompt flow.
8. Persist the session id only after initialization succeeds.
9. Keep loaded sessions unchanged.
10. Keep `src/acp/index.ts` unchanged unless the prompt input needs to become structured later.
11. Deferred: add unit tests for prompt formatting: no custom prompt, file prompt, empty prompt.
12. Deferred: add an integration test with the test ACP agent to verify that new sessions receive the init
    prompt before the user prompt, `/session new` initializes its fresh session, and loaded sessions
    do not receive it again.
13. Update `README.md` and `docs/architecture.md` with the new config option and session-new refresh
    behavior.
14. Run `pnpm lint` and `pnpm test`.

## Later Iterations

- Add `/prompt show` and `/prompt reload` Telegram commands.
- Add per-chat or per-session prompt profiles if one deployment needs multiple personas.
- Add config-file support once the broader config mechanism lands.
- Consider agent-specific adapters only if a real agent exposes a stable system-prompt option and the
  agent-agnostic fallback remains available.

## Non-Goals

- Do not write or modify `AGENTS.md` automatically.
- Do not depend on ACP `_meta` for behavior.
- Do not silently apply a changed prompt file to existing sessions.
- Do not add Codex-only behavior to the common path.
