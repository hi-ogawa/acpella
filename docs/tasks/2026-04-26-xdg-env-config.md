# Env File Strategy

## Problem context and approach

Different acpella entrypoints currently risk resolving configuration from different places. That makes it easy for `serve`, `repl`, and `exec` to accidentally operate on different `ACPELLA_HOME` directories, state files, cron jobs, sessions, or prompt customization.

Define a single env-file strategy that every CLI command goes through before `loadConfig()`.

The default command-line behavior should load the XDG config env file:

```bash
${XDG_CONFIG_HOME:-~/.config}/acpella/.env
```

The source checkout remains a development mode by explicitly selecting the repository env file:

```bash
pnpm cli ... -> ./.env
```

This keeps normal CLI usage aligned by default while preserving checkout-local development ergonomics.

## Intended behavior

- `acpella serve`, `acpella repl`, and `acpella exec ...` all use the same env selection rules.
- Without flags, acpella loads `${XDG_CONFIG_HOME:-~/.config}/acpella/.env` if it exists.
- `--env-file <path>` selects one env file for that process and disables the default XDG env file.
- The selected env file is loaded before app config is resolved.
- Existing process env values win over env-file values.
- Missing default XDG env files are allowed.
- Missing explicit env files are errors.
- `pnpm cli ...` is source-checkout development mode. It should select repo `.env` explicitly, so it is easy to see when dev usage differs from default CLI usage.
- `ACPELLA_HOME` remains the important alignment point. Commands share state only when they resolve the same `ACPELLA_HOME`.

## Reference files/patterns to follow

- `src/lib/env.ts`
  - Own env-file path resolution and loading behavior.
- `src/lib/cli.ts`
  - Own global CLI option parsing such as `--env-file`.
  - Keep global options before the command so `exec` can treat everything after `exec` as message text.
- `src/cli.ts`
  - Load env before calling `loadConfig()`.
  - Keep `serve`, `repl`, and `exec` on the same config-loading path.
- `src/config.ts`
  - Remain the layer that turns environment variables into `AppConfig`.
  - Do not make config know whether env came from XDG config, explicit override, or dev script.
- `package.json`
  - Preserve `pnpm cli` and `pnpm repl` as source-checkout conveniences.
  - Stop relying on Node-level env-file flags long term; package scripts should select the dev env file through acpella's own CLI/env loading path.
- `skills/acpella`
  - Document the distinction between normal CLI usage and source-checkout development usage after the behavior is implemented.

## Implementation plan

1. Define env-file modes.
   - Default mode: load `${XDG_CONFIG_HOME:-~/.config}/acpella/.env`.
   - Explicit override mode: `--env-file <path>` loads exactly that file.
   - Development script mode: `pnpm cli` passes `--env-file .env` from the source checkout.

2. Define missing-file behavior.
   - Missing default XDG env file should be allowed so `/help`, tests, and minimal local commands can still run.
   - Missing explicit `--env-file` target should be an error because the user or script intentionally selected that file.
   - Development scripts can decide whether they want strict `--env-file .env` or a separate optional mode. Prefer strict unless checkout workflows commonly run without `.env`.

3. Keep precedence simple.
   - Existing process environment stays highest priority.
   - Env-file values fill missing process env values.
   - Do not load more than one env file in a single process by default.

4. Wire all commands through the same loading path.
   - `serve`, `repl`, and `exec` should all load env before config resolution.
   - The default command should behave the same as `serve`.
   - `--env-file` should be accepted before the command only, for example `acpella --env-file /tmp/dev.env exec /status`.

5. Preserve source-checkout ergonomics deliberately.
   - Keep `pnpm cli`, `pnpm repl`, and `pnpm cli exec ...` working from the repository.
   - Make those scripts select repo `.env` explicitly through the acpella CLI option rather than Node's env-file flag.
   - Document that `pnpm cli` may operate on different state than default CLI usage if repo `.env` and XDG config point to different `ACPELLA_HOME` values.

6. Make state alignment visible.
   - Ensure `/status` includes enough information to detect config mismatch, especially active `ACPELLA_HOME`.
   - Consider surfacing the selected env-file path in diagnostic output or debug logs, but avoid exposing secret values.

7. Update tests.
   - Cover default XDG env-file resolution with and without `XDG_CONFIG_HOME`.
   - Cover explicit `--env-file`.
   - Cover missing default versus missing explicit behavior.
   - Cover process-env precedence over env-file values.
   - Cover `pnpm cli` or equivalent dev invocation using repo `.env`.

8. Remove systemd working-directory dependence.
   - Keep systemd from selecting config or state implicitly through process cwd.
   - Since `EnvironmentFile` is already removed, remove `WorkingDirectory` from the generated unit as well.
   - Ensure the service still resolves the same default env file and `ACPELLA_HOME` as `acpella exec ...` run from elsewhere.

## Open questions

- Should development scripts require repo `.env`, or should there be an explicit optional env-file mode for source checkout commands?
- Should `/status` show the env-file path used, or is showing `home` enough for normal diagnostics?
- Should there be a helper command to print or initialize the default XDG env-file path?
