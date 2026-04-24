# acpella

Thin service that connects a messaging channel (Telegram) to AI agent via [ACP](https://github.com/agentclientprotocol/agent-client-protocol). Agent-agnostic — works with Codex, Claude Code, or any ACP-compatible agent.

## Setup and Run

```bash
pnpm install
pnpm build
pnpm link --global

mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/acpella"
cp .env.example "${XDG_CONFIG_HOME:-$HOME/.config}/acpella/.env"
# edit the copied .env using the Config section below

acpella serve         # run Telegram bot service
acpella repl          # run REPL
acpella exec /status  # run one local admin command
```

From the source checkout during development, `pnpm cli`, `pnpm repl`, and `pnpm cli exec /status` still load local `.env` as a convenience.

## Config

Installed `acpella` reads `${XDG_CONFIG_HOME:-~/.config}/acpella/.env` by default. Use `--env-file <path>` to load a different env file for one invocation. Existing process environment values take precedence over values in env files.

| Variable                            | Default         | Description                                |
| ----------------------------------- | --------------- | ------------------------------------------ |
| `ACPELLA_TELEGRAM_BOT_TOKEN`        | —               | Bot token from @BotFather                  |
| `ACPELLA_TELEGRAM_ALLOWED_USER_IDS` | —               | Comma-separated numeric Telegram user IDs  |
| `ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS` | —               | Comma-separated chat IDs (group allowlist) |
| `ACPELLA_HOME`                      | `process.cwd()` | Agent working directory                    |

## Configuring Agent

The default agent is the built-in `test` echo agent. See [`skills/acpella`](skills/acpella) for current agent registration, session, customization, cron, and service administration workflows.

## Development

```bash
pnpm cli serve
pnpm cli repl
pnpm cli exec /status
```

## Docs

- [`skills/acpella`](skills/acpella) — maintained usage and administration guide for agents
- [`docs/architecture.md`](docs/architecture.md) — design decisions, data flow
