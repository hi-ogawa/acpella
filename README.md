# acpella

Thin service that connects a messaging channel (Telegram) to AI agent via [ACP](https://github.com/agentclientprotocol/agent-client-protocol). Agent-agnostic — works with Codex, Claude Code, or any ACP-compatible agent.

## Setup

```bash
pnpm install

# Make `acpella` cli available globally
pnpm link --global

# Edit .env using the Config section below
mkdir -p ~/.config/acpella
cp .env.example ~/.config/acpella/.env

acpella serve        # run Telegram bot service
acpella repl         # run REPL
acpella exec /status # run one local admin command
```

## Config

| Variable                            | Default         | Description                                |
| ----------------------------------- | --------------- | ------------------------------------------ |
| `ACPELLA_TELEGRAM_BOT_TOKEN`        | —               | Bot token from @BotFather                  |
| `ACPELLA_TELEGRAM_ALLOWED_USER_IDS` | —               | Comma-separated numeric Telegram user IDs  |
| `ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS` | —               | Comma-separated chat IDs (group allowlist) |
| `ACPELLA_HOME`                      | `process.cwd()` | Agent working directory                    |

## Configuring Agent

The default agent is the built-in `test` echo agent. See [skills/acpella](skills/acpella/SKILL.md) for current agent registration, session, customization, cron, and service administration workflows.

## Development

Test locally on checkout source

```sh
pnpm install

# run with .env.dev
pnpm dev repl
pnpm dev exec /status

# run with global ~/.config/acpella/.env if exists
pnpm cli repl
pnpm cli exec /status
```

## Docs

- [`skills/acpella`](skills/acpella/SKILL.md) — maintained usage and administration guide for agents
- [`docs/architecture.md`](docs/architecture.md) — design decisions, data flow
