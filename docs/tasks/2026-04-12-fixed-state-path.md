# Fixed State Path

## Problem Context

`src/config.ts` currently exposes `stateFile` as application config and accepts `stateFile`
from `acpella.config.json`. That makes persisted service state look like a user-facing behavior
setting and keeps state-file path ownership in the config loader.

For this refactor step, keep `AppConfig.stateFile` as a resolved runtime value, remove `stateFile`
from raw user config, and force the persistence file under the resolved app home:

```text
<config.home>/.acpella/state.json
```

## Reference Files

- `src/config.ts` - app config schema and path resolution
- `src/state.ts` - persisted session state read/write
- `src/handler.ts` - `/status` output and state store construction
- `src/e2e/helper.ts` - test service environment already provides temporary `ACPELLA_HOME`

## Implementation Plan

1. Remove `stateFile` from the raw config schema only.
2. Make `home` independent of raw config so the default config file can be inferred from it.
3. Infer the default config path as `<home>/acpella.config.json`.
4. Keep `AppConfig.stateFile` and set it inline in `loadConfig()` from the resolved app home.
5. Keep `state.ts` consuming `config.stateFile`.
6. Keep tests isolated through the existing temporary `ACPELLA_HOME`.
7. Run lint and the unit/e2e smoke tests.
