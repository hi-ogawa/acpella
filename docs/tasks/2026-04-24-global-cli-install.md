# Global CLI Install

## Problem context and approach

Acpella's current documented command surface assumes the user is inside the acpella source checkout:

```bash
pnpm cli
pnpm repl
pnpm cli exec /status
```

That is fine for development, but it is a poor long-term operational model. Agents and users need a stable `acpella` executable that works without knowing where the source checkout lives. The source checkout should become a development detail, while installed usage should look like:

```bash
acpella serve
acpella repl
acpella exec /status
```

Configuration should remain env-file based. The installed CLI should read `${XDG_CONFIG_HOME}/acpella/.env` by default, falling back to `~/.config/acpella/.env` when `XDG_CONFIG_HOME` is unset. A CLI `--env-file <path>` option should override that default for one invocation.

Keep `ACPELLA_HOME` as the agent/session/state root. Do not conflate it with the installation directory or the config directory:

- installation/package location: where the CLI code is installed
- config env file: `${XDG_CONFIG_HOME:-~/.config}/acpella/.env` by default
- `ACPELLA_HOME`: working directory for agent sessions and `.acpella` state
- source checkout: development-only location where `pnpm cli` works

## Reference files/patterns to follow

- `src/cli.ts`
  - Owns `serve`, `repl`, and `exec`.
  - Currently relies on package scripts for `.env` loading: `node --env-file-if-exists=.env src/cli.ts`.
- `src/lib/cli.ts`
  - Small parser for top-level command selection.
  - Extend or replace carefully if adding global options such as `--env-file`.
- `src/config.ts`
  - Reads environment variables and resolves `ACPELLA_HOME`.
  - Should remain the single place that turns environment into app config.
- `src/lib/systemd.ts`
  - Renders the user systemd unit.
  - Eventually should generate `ExecStart=<installed acpella executable> serve`, not `node <source>/src/cli.ts`.
- `package.json`
  - Add a `bin` entry after a build output exists.
  - Keep `pnpm cli` and `pnpm repl` as development conveniences.
- `skills/acpella`
  - Current skill docs explicitly say `pnpm cli` assumes the acpella source checkout.
  - Update these docs after the installed CLI path exists.

## Implementation plan

1. Add a production build output for the CLI.
   - Compile TypeScript to a runnable `dist/cli.js` or equivalent.
   - Add a Node shebang to the executable output.
   - Preserve NodeNext import behavior, including `.ts` source imports during development and compiled imports in build output.

2. Add a `bin` entry to `package.json`:

   ```json
   {
     "bin": {
       "acpella": "./dist/cli.js"
     }
   }
   ```

3. Implement env-file loading inside the CLI instead of relying only on package scripts.
   - Default path: `${XDG_CONFIG_HOME:-$HOME/.config}/acpella/.env`.
   - Add global `--env-file <path>` to override the default.
   - Decide whether missing default env files are ignored.
   - Decide whether missing explicit `--env-file` should be an error; likely yes.
   - Load env before `loadConfig()` runs.
   - Keep existing process environment values authoritative if both process env and env file define the same key, unless a different precedence is explicitly chosen.

4. Preserve development commands.
   - Keep `pnpm cli`, `pnpm repl`, and `pnpm cli exec ...` working from the source checkout.
   - These can continue using `node --env-file-if-exists=.env src/cli.ts` as a source-checkout convenience.
   - The installed `acpella` binary should use the global config env file by default.

5. Update systemd installation.
   - Prefer rendering `ExecStart=<installed acpella executable> serve`.
   - If running from the source checkout during development, keep a clear dev fallback.
   - Ensure the generated unit includes enough `PATH` for agent adapter commands such as `npx` or `codex-acp`.
   - Consider rendering `EnvironmentFile=${XDG_CONFIG_HOME:-~/.config}/acpella/.env` or relying on CLI env-file loading, but avoid double-loading surprises.

6. Update docs and skill guidance after the binary works.
   - README should prefer `acpella ...`.
   - `skills/acpella` should document installed usage first and source-checkout `pnpm cli` as a development fallback.
   - Keep `ACPELLA_HOME` clearly distinct from the source checkout and config directory.

7. Add tests.
   - CLI parser tests for global `--env-file` before and after commands.
   - Config/env loading tests for default env path and explicit override.
   - Systemd rendering tests for installed binary path.
   - Smoke test that `acpella exec /status` works from a directory outside the source checkout.

## Open questions

- Should `--env-file` be accepted only before the command, or also after it?
- Should the default env file be loaded for `repl` and `exec`, or only for `serve`? The likely answer is all commands.
- Should explicit `--env-file` override existing process env values, or should existing process env stay highest priority?
- How should a development checkout discover an installed binary path for systemd generation?
- Should there be a native `acpella service systemd install` command in addition to `/service systemd install` through `exec`?
