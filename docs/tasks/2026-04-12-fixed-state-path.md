# Fixed State Path

## Problem Context

`src/config.ts` grew support for a user config file while the current service can be configured
well enough through environment variables. The config file path and `home` interaction also creates
unnecessary ordering questions.

For this refactor step, remove config file support entirely, keep `AppConfig.stateFile` as a
resolved runtime value, and force the persistence file under the resolved app home:

```text
<config.home>/.acpella/state.json
```

## Reference Files

- `src/config.ts` - app config schema and path resolution
- `src/state.ts` - persisted session state read/write
- `src/handler.ts` - `/status` output and state store construction
- `src/e2e/helper.ts` - test service environment already provides temporary `ACPELLA_HOME`

## Implementation Plan

1. Remove `ACPELLA_CONFIG`, raw config schemas, and config file loading.
2. Resolve `home` from `ACPELLA_HOME`, falling back to `process.cwd()`.
3. Resolve the agent from `ACPELLA_AGENT`, falling back to the built-in `codex` alias.
4. Keep `AppConfig.stateFile` and set it inline in `loadConfig()` from the resolved app home.
5. Keep `state.ts` consuming `config.stateFile`.
6. Remove redundant `home` data from persisted state scopes because the state file is already
   stored under the resolved home.
7. Keep tests isolated through the existing temporary `ACPELLA_HOME`.
8. Run lint and the unit/e2e smoke tests.
