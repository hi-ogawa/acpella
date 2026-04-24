# acpella

Thin service that connects a messaging channel (Telegram) to AI agent via [ACP](https://github.com/agentclientprotocol/agent-client-protocol). Agent-agnostic — works with Codex, Claude Code, or any ACP-compatible agent.

## Setup and Run

```bash
pnpm install
cp .env.example .env
# edit .env using the Config section below

pnpm cli       # run Telegram bot service
pnpm cli repl  # run REPL
pnpm repl      # run REPL
```

## Config

| Variable                            | Default         | Description                                |
| ----------------------------------- | --------------- | ------------------------------------------ |
| `ACPELLA_TELEGRAM_BOT_TOKEN`        | —               | Bot token from @BotFather                  |
| `ACPELLA_TELEGRAM_ALLOWED_USER_IDS` | —               | Comma-separated numeric Telegram user IDs  |
| `ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS` | —               | Comma-separated chat IDs (group allowlist) |
| `ACPELLA_HOME`                      | `process.cwd()` | Agent working directory                    |

### `$ACPELLA_TELEGRAM_*`

Telegram related configuration is not required for `repl` mode.

### `$ACPELLA_HOME/.acpella/AGENTS.md`

If this file exists, its contents are sent as custom instructions once when creating a new session.

## Configuring Agent

The default agent is the built-in `test` echo agent. Register a real ACP agent after starting
acpella:

```sh
/agent new codex codex-acp
/agent default codex
```

Known ACP agents are listed in the [ACP agent registry](https://agentclientprotocol.com/get-started/registry).

For Codex ACP, either install `@zed-industries/codex-acp` globally and run:

```sh
/agent new codex codex-acp
```

Or run it through `npx`:

```sh
/agent new codex npx -y @zed-industries/codex-acp
```

Gotcha: Codex ACP reads Codex CLI configuration through its own `-c key=value` override flag.
If you want Codex to run without sandboxing, pass that through the agent command:

```sh
/agent new codex codex-acp -c sandbox_mode=danger-full-access
```

Check `codex-acp --help` for the current configuration override syntax before changing flags.

## Docs

- [`docs/deploy.md`](docs/deploy.md) — systemd unit, install steps
- [`docs/architecture.md`](docs/architecture.md) — design decisions, data flow
