# Config Mechanism

## Problem Context

**Context:** [`src/handler.ts#L24`](../../src/handler.ts#L24)

`createHandler` currently resolves `agent` and `cwd` from environment variables, then uses
`<cwd>/acpella.json` as a session-name to ACP session-id map. In the new config shape, expose this
directory as user-facing `home`; internal ACP calls can still pass it as `cwd`/`sessionCwd`.

`acpella.json` is persisted state today, not user configuration. The filename is misleading for
future user options such as schedules, allowlists, daily refresh, agent selection, or session
policy.

## Reference Files

- [`src/handler.ts`](../../src/handler.ts) - currently owns env reads and session state persistence
- [`src/index.ts`](../../src/index.ts) - currently owns Telegram env reads and service wiring
- [`docs/prd.md`](../prd.md) - tracks `refactor: env config util`
- [`docs/architecture.md`](../architecture.md) - describes current service/session model

## Approach

- Keep secrets in `.env`/environment only: Telegram token, private allowlists if desired.
- Introduce a real app config file for non-secret options.
- Rename session persistence away from `acpella.json`, for example `.acpella/state.json`.
- Add a small `src/config.ts` that performs config-file loading, env overlay, path resolution, and
  schema validation.
- Make `src/config.ts` the only module that reads `process.env`. Other modules receive typed config
  objects through function parameters.
- Define explicit precedence so behavior is predictable.

## Candidate Shape

Config file:

```json
{
  "version": 1,
  "agent": "codex",
  "agents": {
    "codex": {
      "command": "./node_modules/@zed-industries/codex-acp/bin/codex-acp.js"
    }
  },
  "home": "/home/hiroshi/code/personal/acpella",
  "stateFile": ".acpella/state.json",
  "telegram": {
    "allowedUserIds": [123],
    "allowedChatIds": []
  }
}
```

State file at `stateFile`:

```json
{
  "version": 1,
  "scopes": {
    "codex:a1b2c3d4:9a3f...": {
      "agent": {
        "alias": "codex",
        "command": "/home/hiroshi/code/personal/acpella/node_modules/@zed-industries/codex-acp/bin/codex-acp.js"
      },
      "home": "/home/hiroshi/code/personal/acpella",
      "sessions": {
        "tg-123": {
          "sessionId": "__testLoadSession"
        }
      }
    }
  }
}
```

Use `zod` for validation.

`agent` is the selected agent alias. `agents` defines user-configurable aliases. Merge these with
built-in aliases in `src/config.ts`, with config aliases overriding built-ins of the same name.
Normalize the selected alias to the command passed to ACP before it leaves `src/config.ts`.

Keep at least one built-in alias so a minimal config can stay small:

```json
{
  "version": 1,
  "agent": "codex",
  "home": "."
}
```

Built-in `codex` should resolve to the local package path:

```text
./node_modules/@zed-industries/codex-acp/bin/codex-acp.js
```

The resolved command should be absolute in `AppConfig`, but the state scope should keep the selected
alias (`codex`) as its readable identity.

## Versioning

Version both user config and persisted state. They are separate formats and should evolve
independently.

User config:

```json
{
  "version": 1,
  "agent": "codex",
  "home": ".",
  "stateFile": ".acpella/state.json"
}
```

Session state:

```json
{
  "version": 1,
  "scopes": {
    "codex:a1b2c3d4:9a3f...": {
      "agent": {
        "alias": "codex",
        "command": "/home/hiroshi/code/personal/acpella/node_modules/@zed-industries/codex-acp/bin/codex-acp.js"
      },
      "home": "/home/hiroshi/code/personal/acpella",
      "sessions": {
        "tg-123": {
          "sessionId": "__testLoadSession"
        }
      }
    }
  }
}
```

ACP sessions are agent-specific, so the state must not be a flat `telegram session -> ACP sessionId`
map. Loading a Codex session ID into a Claude ACP server, or into the same agent with a different
home, is invalid or at least ambiguous.

Use a scope key derived from selected agent alias, resolved agent command, and resolved `home`. For
example:

```ts
scopeKey = `${agent.alias}:${hash(agent.command)}:${hash(home)}`;
```

The exact hash format is not important as long as it is deterministic and only used internally. Keep
the readable `agent.alias`, `agent.command`, and `home` fields in the state for debugging.

Make `version` required for new files. Since the project is early, strict is simpler than carrying
implicit legacy behavior. If needed, the loader can temporarily treat missing config version as v1,
but that should be deliberate.

Do not build a large migration framework yet. Use simple version dispatch:

```ts
function parseConfig(raw: unknown): AppConfig {
  const version = getVersion(raw);
  if (version === 1) {
    return parseConfigV1(raw);
  }
  throw new Error(`Unsupported config version: ${version}`);
}
```

When v2 exists, add a local `migrateV1ToV2` or parse v1 directly into the normalized internal
`AppConfig`. Keep migrations close to the parser until real complexity appears.

Apply the same simple version dispatch to session state, but keep state parsing in `src/state.ts` so
config migration and state migration do not get coupled.

## Code Organization

Recommended split:

- `src/config.ts`
  - owns all `process.env.*` access
  - loads optional config file
  - validates raw values with zod
  - resolves `home` and `stateFile`
  - merges built-in and file-defined agent aliases
  - normalizes the selected agent alias to a resolved command
  - returns `AppConfig`
- `src/state.ts`
  - owns session state read/write
  - validates persisted state separately from app config
- `src/handler.ts`
  - accepts resolved handler/session config
  - does not inspect env or config files
- `src/index.ts`
  - calls `loadConfig()`
  - wires Telegram and handler from typed config

This gives one boundary for untrusted input and keeps runtime modules deterministic in tests.

Use names deliberately:

- `home`: user-facing workspace/root directory for agent sessions
- `cwd`/`sessionCwd`: internal ACP terminology derived from `home`
- `stateFile`: acpella persistence file location, not a session behavior setting

## Env vs File Precedence

Use a simple layered model:

1. built-in defaults
2. config file
3. environment variables

Environment wins because it is useful for deployments, one-off local runs, and test overrides.
Config file remains the stable local/default behavior.

Suggested env schema:

- `ACPELLA_CONFIG`: optional path to config file
- `ACPELLA_AGENT`: overrides `agent`
- `ACPELLA_HOME`: overrides `home`
- `ACPELLA_TELEGRAM_BOT_TOKEN`: secret, env-only
- `ACPELLA_TELEGRAM_ALLOWED_USER_IDS`: overrides `telegram.allowedUserIds`
- `ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS`: overrides `telegram.allowedChatIds`
- `ACPELLA_TEST_CHAT_ID`: sets the default in-process test bot chat id

REPL/test-bot mode is selected with the `--repl` CLI flag, not an environment variable.

For allowlists, use override semantics rather than merging. Merging makes it harder to remove an ID
in a deployment.

## Path Resolution

Resolve paths once in `src/config.ts` and expose absolute paths in `AppConfig`.

- `ACPELLA_CONFIG` is resolved relative to `process.cwd()` if it is not absolute.
- `home` from the config file is resolved relative to the config file directory if it is not
  absolute.
- `ACPELLA_HOME` is resolved relative to `process.cwd()` if it is not absolute.
- `stateFile` is resolved relative to `home` if it is not absolute.

## Implementation Plan

1. Add `src/config.ts` with zod schemas for raw config, env parsing, alias resolution, path
   resolution, and one typed `AppConfig`.
2. Add `src/state.ts` with versioned state parsing/writing and scoped session APIs.
3. Refactor `src/handler.ts` to accept resolved config and state helpers instead of reading env or
   touching `acpella.json` directly.
4. Refactor `src/index.ts` to call `loadConfig()` once and pass typed config into Telegram and
   handler setup.
5. Update tests to use config/env overrides without relying on repo-root `acpella.json`.
