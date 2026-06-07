# acpella

Thin service that connects a messaging channel (Telegram) to AI agent via [ACP](https://github.com/agentclientprotocol/agent-client-protocol). Agent-agnostic — works with [OpenCode](https://github.com/anomalyco/opencode), [Codex](https://github.com/zed-industries/codex-acp/), or any [ACP-compatible agent](https://agentclientprotocol.com/get-started/agents).

## Setup

```bash
npm install -g github:hi-ogawa/acpella

mkdir -p ~/.config/acpella
${EDITOR:-vi} ~/.config/acpella/.env

acpella repl
acpella exec /status
```

Set the required values from the Config section below. For deployment, systemd, agent registration, cron, and troubleshooting workflows, see [`skills/acpella`](skills/acpella/SKILL.md).

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
pnpm vp config

# optionally make this checkout available as the global CLI while developing
pnpm link --global

# run with .env.dev
pnpm dev repl
pnpm dev exec /status

# run with global ~/.config/acpella/.env if exists
pnpm cli repl
pnpm cli exec /status
```

## Docs

- [`skills/acpella`](skills/acpella/SKILL.md) — maintained usage and administration guide for agents
