# Stable systemd PATH for child Node tools

## Problem context and approach

Issue: <https://github.com/hi-ogawa/acpella/issues/24>

After reboot, `acpella.service` can start because the generated unit uses `process.execPath` as an absolute Node binary in `ExecStart`. Agent prompts can still fail when the configured ACP child process runs an npm package wrapper whose shebang is `#!/usr/bin/env node`. In that rebooted user-systemd environment, `PATH` may not include the active fnm Node installation and the host may not have `/usr/bin/node`, so the wrapper exits and acpella later sees `write EPIPE`.

The fix should make `pnpm cli --setup-systemd` render a stable service environment. The unit should explicitly set `HOME`, `TMPDIR`, and `PATH`, put `dirname(process.execPath)` first, avoid transient fnm multishell path entries, and include fallback system paths.

## Reference files/patterns to follow

- `src/lib/systemd.ts` owns the current acpella systemd unit rendering.
- `docs/tasks/2026-04-12-systemd-unit-generator.md` is the previous task note for the systemd generator.
- `refs/openclaw/src/daemon/systemd-unit.ts` renders canonical user-systemd units:
  - Adds `After=network-online.target` and `Wants=network-online.target`.
  - Renders service environment as inline `Environment=KEY=value` lines.
  - Escapes values and rejects CR/LF in rendered systemd values.
  - Uses `Restart=always`, short restart delays, explicit start/stop timeouts, and `KillMode=control-group`.
- `refs/openclaw/src/daemon/service-env.ts` builds daemon environments:
  - Sets `HOME` from the install environment.
  - Sets `TMPDIR` from the host env, falling back to `os.tmpdir()`.
  - Builds a minimal service `PATH` instead of copying the login-shell `PATH`.
  - Prepends the selected Node runtime directory through `extraPathDirs`; install helpers pass `dirname(nodePath)`.
  - Adds stable Linux user bin paths such as `~/.local/bin`, `~/.npm-global/bin`, `~/bin`, `~/.volta/bin`, `~/.asdf/shims`, `~/.bun/bin`, `~/.nvm/current/bin`, `~/.fnm/current/bin`, and `~/.local/share/pnpm`.
  - Adds system fallback paths `/usr/local/bin`, `/usr/bin`, and `/bin`.
  - De-duplicates while preserving first occurrence.
- `refs/openclaw/src/commands/daemon-install-plan.shared.ts` has the small helper `resolveDaemonNodeBinDir(nodePath)` which returns `[dirname(nodePath)]` only for absolute paths.

OpenClaw avoids volatile `/run/user/.../fnm_multishells/...` entries mostly by not deriving service `PATH` from `process.env.PATH` at all. It constructs a minimal deterministic path from the chosen runtime, stable user directories, and system fallback directories.

## Implementation plan

- Add a small `buildServicePath` helper in `src/lib/systemd.ts`.
- Put `dirname(process.execPath)` first in the rendered `PATH`.
- Include stable user bin paths using `homedir()` and fallback system paths.
- If acpella also uses selected entries from `process.env.PATH`, filter entries containing `/run/user/` and `/fnm_multishells/`; otherwise prefer the OpenClaw-style minimal path and avoid copying the host path.
- Render inline `Environment=HOME=...`, `Environment=TMPDIR=...`, and `Environment=PATH=...` lines.
- Add `After=network-online.target` and `Wants=network-online.target`.
- Add focused unit tests for:
  - Node bin directory is first.
  - transient fnm multishell entries are not included.
  - fallback system paths are present.
  - environment lines are escaped when needed.
- Run `pnpm test` or at least the unit project for the changed tests, then `pnpm lint-check` if time permits.
