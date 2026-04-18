# Security Review

## Scope

Comprehensive review of `acpella` — a Telegram-to-ACP-agent bridge — covering the authentication model, command routing, agent process lifecycle, state persistence, and prompt handling.

Files reviewed:
- `src/cli.ts` — entry point, bot wiring, allowlist enforcement
- `src/config.ts` — environment-variable config loader
- `src/handler.ts` — command router and prompt dispatcher
- `src/state.ts` — on-disk state store
- `src/acp/index.ts` — agent process spawning and ACP protocol client
- `src/lib/prompt.ts` — AGENTS.md loader with `@include` support
- `src/lib/systemd.ts` — systemd unit generator
- `src/lib/telegram.ts` — session naming and sequential key
- `src/lib/reply.ts` — outbound message batching
- `src/repl.ts` — local REPL / test bot

---

## Findings

### HIGH — Arbitrary host command execution via `/agent new`

**Location:** `src/handler.ts` `handleAgentCommand` → `src/acp/index.ts` `spawnAgent`

Any user in the Telegram allowlist can register an agent with an arbitrary shell command:

```
/agent new myagent bash -c "rm -rf ~"
```

`spawnAgent` splits the stored command string on whitespace and passes it directly to `child_process.spawn`. While `spawn` does not invoke a shell (so standard shell metacharacters are not interpreted), the binary and all arguments are fully attacker-controlled. An allowed user can execute any reachable binary with arbitrary arguments, running under the same OS identity as the acpella service.

**Risk:** Complete host compromise by any user in the allowlist. The allowlist is intended to control *bot access*, not grant OS-level execution authority.

**Recommended mitigations:**
- Restrict `/agent new` (and `/agent remove`, `/agent default`) to an operator-only tier (e.g., an admin user ID set from the environment). Regular allowed users get chat-only access.
- Alternatively, remove `/agent new` from the runtime command surface entirely and manage agents only through the on-disk state file (admin edit → service restart), consistent with the existing operator model.
- If runtime agent management is kept, validate the command against a configurable allowlist or use an explicit array format in config rather than a freeform string.

---

### MEDIUM — Approve-all ACP permission handler

**Location:** `src/acp/index.ts` lines 90–96

```ts
async requestPermission(params) {
  // acpx --approve-all like behavior
  const first = params.options[0];
  if (!first) {
    return { outcome: { outcome: "cancelled" } };
  }
  return { outcome: { outcome: "selected", optionId: first.optionId } };
},
```

All agent permission requests are automatically granted by selecting the first available option without any user interaction or filtering. This silently approves potentially dangerous agent actions (e.g., file system writes, shell commands, network calls) that the ACP protocol was designed to gate behind an interactive confirmation.

**Risk:** If the registered agent supports destructive or sensitive tool calls, any allowed Telegram user can trigger them without explicit consent beyond sending a prompt.

**Recommended mitigations:**
- Forward permission requests to the Telegram session and wait for user approval (yes/no inline button or text reply) before returning the outcome.
- At minimum, make this behavior opt-in and documented so operators understand it is equivalent to `--approve-all`.

---

### MEDIUM — Prompt file arbitrary file inclusion

**Location:** `src/lib/prompt.ts` `readPromptFileWithIncludes`

The `AGENTS.md` file supports `@<path>` include directives. Absolute paths are accepted:

```ts
const target = path.isAbsolute(includePath)
  ? includePath
  : path.resolve(path.dirname(file), includePath);
```

If AGENTS.md is world-writable (e.g., placed in a shared directory), or if the ACPELLA_HOME directory is writable by a non-operator, an attacker with local filesystem access can inject `@/etc/passwd` or `@<path-to-secret>` to include sensitive files into the agent's first-turn system prompt.

**Risk:** Credential or secret exfiltration via the agent's context window on new sessions.

**Recommended mitigations:**
- Restrict included paths to files under `ACPELLA_HOME` (reject paths that escape the configured home directory after normalization).
- Document that AGENTS.md and its include targets must be operator-writable only.

---

### LOW — Error messages leak internal details

**Location:** `src/cli.ts` line 127

```ts
await ctx.reply(`Error: ${msg.slice(0, 200)}`);
```

All uncaught handler errors, up to 200 characters, are forwarded verbatim to the Telegram chat. Error messages can include file system paths (e.g., `ENOENT: no such file or directory, open '/home/user/.acpella/state.json'`), agent command strings, session IDs, and stack fragments.

**Risk:** Information disclosure to allowed users; particularly relevant if the bot serves multiple mutually untrusting users.

**Recommended mitigations:**
- Log the full error server-side and reply with a generic message (e.g., `"An internal error occurred."`).
- Or categorize errors: return safe details only for expected user-facing errors, suppress internals otherwise.

---

### LOW — State file written without explicit permissions

**Location:** `src/state.ts` `writeState`

```ts
fs.writeFileSync(config.stateFile, JSON.stringify(nextState, null, 2));
```

No file permission mode is specified; the file inherits the process umask. The state file contains registered agent commands and session identifiers. On a shared system with a permissive umask, the file may be readable by other local users.

**Risk:** Disclosure of agent configuration and session IDs to other OS users on the same host.

**Recommended mitigations:**
- Create the file with mode `0o600`: `fs.writeFileSync(config.stateFile, data, { mode: 0o600 })`.
- Similarly, restrict the `.acpella/` directory: `fs.mkdirSync(dir, { recursive: true, mode: 0o700 })`.

---

### LOW — `/service exit` available to all allowed users

**Location:** `src/handler.ts` `handleServiceCommand`

Any user in the Telegram allowlist can halt the service by sending `/service exit`. There is no admin-only tier.

**Risk:** Denial of service: any allowed user can stop the bot.

**Recommended mitigations:**
- Add an optional `ACPELLA_TELEGRAM_ADMIN_USER_IDS` config variable. Gate `/service exit` (and `/agent new`/`remove`/`default`) on membership in that set.
- Fall back to permitting these commands to all allowed users only when no admin list is configured (backward-compatible default).

---

### LOW — No rate limiting

**Location:** `src/cli.ts`, `src/handler.ts`

There is no rate limiting per user, per session, or globally. An allowed user can send an unlimited number of prompts in rapid succession. Each prompt spawns one or more agent child processes (one per `newSession`/`loadSession`/`listSessions`/`closeSession` call), creating a resource exhaustion vector.

**Risk:** CPU/memory exhaustion and agent process storm by any allowed user; could make the service unresponsive for others.

**Recommended mitigations:**
- Track in-flight session count per user and reject new prompts while one is already active (the current `activeSessions` map already blocks concurrent prompts *per session*, but not across different sessions of the same user).
- Add a configurable global concurrency cap in addition to the existing `concurrency: 4` runner limit.

---

### LOW — State file writes are not atomic

**Location:** `src/state.ts` `writeState`

`fs.writeFileSync` overwrites the file in-place. A crash mid-write could corrupt the state file, which is the only persistent record of session mappings.

**Risk:** On crash or power loss during a write, the state file may be partially written, leaving acpella unable to resume any sessions.

**Recommended mitigations:**
- Write to a `.tmp` file first, then rename atomically: `writeFileSync(tmp, data); renameSync(tmp, stateFile)`. `rename` is atomic on POSIX when both paths are on the same filesystem.

---

### INFORMATIONAL — Repl mode bypasses all authentication

**Location:** `src/cli.ts` lines 100–111, `src/repl.ts`

When started with `--repl`, no user ID or chat ID checks are applied. Any local user with terminal access can interact with the agent without restriction. This is intentional for development but is worth documenting.

**Recommendation:** Add a startup warning when `--repl` is used to make it clear that access controls are disabled.

---

### INFORMATIONAL — ACPELLA_ env vars correctly stripped from agent

**Location:** `src/acp/index.ts` `createAgentEnv`

All `ACPELLA_`-prefixed environment variables (Telegram token, allowlist, home path) are stripped before passing the environment to child agent processes. This is correct and prevents credential leakage into untrusted agent runtimes.

---

### INFORMATIONAL — No agent response timeout (reliability)

**Location:** `src/handler.ts` `handlePrompt`, `src/todo.md`

This is already tracked in `docs/todo.md` as `fix: handle timeout`. An agent that hangs will block its session indefinitely, with no error returned to the user. This is a reliability concern with secondary security implications: a stuck agent prevents the user from sending new prompts, and `/cancel` may not always succeed, creating a subtle denial-of-service scenario.

---

## Summary Table

| Severity     | Finding                                         | Location                        |
|--------------|-------------------------------------------------|---------------------------------|
| HIGH         | Arbitrary host command execution via `/agent new` | `handler.ts`, `acp/index.ts`   |
| MEDIUM       | Approve-all ACP permission handler             | `acp/index.ts`                  |
| MEDIUM       | Prompt file allows absolute-path file inclusion | `lib/prompt.ts`                |
| LOW          | Error messages leak internal details           | `cli.ts`                        |
| LOW          | State file written without explicit permissions | `state.ts`                     |
| LOW          | `/service exit` available to all allowed users | `handler.ts`                   |
| LOW          | No rate limiting                               | `cli.ts`, `handler.ts`          |
| LOW          | State file writes are not atomic               | `state.ts`                      |
| INFO         | Repl mode bypasses all authentication          | `cli.ts`, `repl.ts`             |
| INFO         | ACPELLA_ env vars correctly stripped from agent | `acp/index.ts` ✓               |
| INFO         | No agent response timeout                      | `handler.ts`, `todo.md`         |
