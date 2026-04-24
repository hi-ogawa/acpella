# CLI top-level commands

## Problem context and approach

`src/cli.ts` currently mixes several entrypoint responsibilities behind flags:

- `node src/cli.ts` starts the Telegram bot service.
- `node src/cli.ts --repl` starts the local readline REPL.
- `node src/cli.ts --setup-systemd` generates a systemd unit.

This worked while acpella had a small surface area, but it is starting to leak architecture. The default command starts a network service, local execution is hidden behind a flag, and deployment plumbing is expressed as a boolean option rather than a first-class operation. One-shot local execution also does not have an obvious CLI-native shape even though it mostly works today via `echo 'prompt' | node src/cli.ts --repl`.

Move toward top-level commands as the public CLI model:

```bash
node src/cli.ts  # intentionally remains `serve` for compatibility
node src/cli.ts serve
node src/cli.ts repl
node src/cli.ts exec <system command or prompt...>
node src/cli.ts systemd install
node src/cli.ts help
```

The high-level split should be:

- `serve`: long-running Telegram delivery service.
- `repl`: long-running interactive local session.
- `exec`: one-shot local message/prompt, then exit.
- Deployment/admin commands: operations like systemd setup should live under a command namespace instead of top-level boolean flags.

For this first pass, `exec` should be a raw dispatch path into the existing handler text protocol. That means system commands still use slash syntax:

```bash
node src/cli.ts exec /status
node src/cli.ts exec /agent list
node src/cli.ts exec "ask the agent something"
```

Do not add CLI-native aliases like `node src/cli.ts agent list` in this task. Those can be layered on later after the top-level command structure is stable.

## Reference files/patterns to follow

- `src/cli.ts` currently parses `--repl`, `--setup-systemd`, and `--help` with `node:util parseArgs`.
- `src/cli.ts` owns both Telegram startup and local REPL startup.
- `startRepl` already contains the local-session send path using `sessionName: "repl"`.
- `createHandler` in `src/handler.ts` exposes `handle`, `prompt`, and `commands`.
- System commands are currently slash-command based in `src/handler.ts`: `/status`, `/agent`, `/session`, `/cron`, `/service`, and `/cancel`.
- `src/lib/systemd.ts` owns the current systemd rendering/setup implementation.
- `README.md` documents `pnpm cli` for Telegram and `pnpm repl` for local REPL.
- `package.json` currently has `cli` and `repl` scripts that should keep working during migration.

## Implementation plan

1. Introduce a small command parser in `src/cli.ts` that separates top-level command selection from command-specific arguments.
2. Add explicit top-level commands:
   - no args means `serve`
   - `serve` maps to current default Telegram behavior.
   - `repl` maps to current `--repl`.
   - `systemd install` maps to current `--setup-systemd`.
   - `help` prints usage.
   - `--help` and `-h` may remain as standard help aliases even though other mode flags are removed.
   - remove current mode flags such as `--repl` and `--setup-systemd`.
3. Add `exec <message text...>` for one-shot local execution:
   - Use the same handler path as REPL.
   - Default to `sessionName: "repl"`
   - Print replies to stdout.
   - Exit non-zero on handler errors.
   - `exec` with no message is a usage error and exits non-zero.
   - Successful handler responses and system command output go to stdout.
   - Handler/application errors go to stderr and set exit code `1`.
   - Do not add stdin support in this task; `exec -` can be considered later.
4. Keep no-args behavior as `serve` in this task to avoid breaking existing deploy scripts. This is compatibility, not the preferred long-term CLI default.
5. Factor local one-shot dispatch into a small helper, for example `runLocalOnce({ text, sessionName })`, so `exec` does not duplicate REPL handler wiring.
6. Update `README.md`, `docs/deploy.md`, and package scripts after the command surface exists.
7. Add tests around parser behavior and one-shot dispatch where practical.
