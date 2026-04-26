# acpella

Thin service that connects a messaging channel (Telegram) to AI agent via [ACP](https://github.com/agentclientprotocol/agent-client-protocol). Agent-agnostic — works with Codex, Claude Code, or any ACP-compatible agent.

## Setup and Run

```bash
pnpm install
cp .env.example .env
# edit .env using the Config section below

pnpm cli serve        # run Telegram bot service
pnpm cli repl         # run REPL
pnpm cli exec /status # run one local admin command
```

## Config

| Variable                            | Default         | Description                                |
| ----------------------------------- | --------------- | ------------------------------------------ |
| `ACPELLA_TELEGRAM_BOT_TOKEN`        | —               | Bot token from @BotFather                  |
| `ACPELLA_TELEGRAM_ALLOWED_USER_IDS` | —               | Comma-separated numeric Telegram user IDs  |
| `ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS` | —               | Comma-separated chat IDs (group allowlist) |
| `ACPELLA_HOME`                      | `process.cwd()` | Agent working directory                    |

## Configuring Agent

The default agent is the built-in `test` echo agent. See [`skills/acpella`](skills/acpella) for current agent registration, session, customization, cron, and service administration workflows.

## Development

Test locally on checkout source

```sh
pnpm i
pnpm cli repl
pnpm cli exec /status
```

## Docs

- [`skills/acpella`](skills/acpella) — maintained usage and administration guide for agents
- [`docs/architecture.md`](docs/architecture.md) — design decisions, data flow
