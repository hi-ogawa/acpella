# acpella

Thin daemon that connects a messaging channel (Telegram) to a coding agent via [ACP](https://github.com/agentclientprotocol/agent-client-protocol). Agent-agnostic — works with Codex, Claude Code, or any ACP-compatible agent.

## Setup

```bash
pnpm install
cp .env.example .env
# fill in ACPELLA_TELEGRAM_BOT_TOKEN and ACPELLA_TELEGRAM_ALLOWED_USER_IDS
```

## Run

```bash
pnpm start        # run daemon
pnpm dev          # run with --watch
```

## Config

| Variable                            | Required | Default         | Description                                |
| ----------------------------------- | -------- | --------------- | ------------------------------------------ |
| `ACPELLA_TELEGRAM_BOT_TOKEN`        | yes      | —               | Bot token from @BotFather                  |
| `ACPELLA_TELEGRAM_ALLOWED_USER_IDS` | yes      | —               | Comma-separated numeric Telegram user IDs  |
| `ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS` | no       | —               | Comma-separated chat IDs (group allowlist) |
| `ACPELLA_AGENT`                     | no       | `codex`         | acpx agent name                            |
| `ACPELLA_HOME`                      | no       | `process.cwd()` | Agent working directory                    |
| `ACPELLA_TEST_BOT`                  | no       | —               | Use the in-process test bot                |

## Docs

- [`docs/architecture.md`](docs/architecture.md) — design decisions, data flow
- [`docs/deploy.md`](docs/deploy.md) — systemd unit, install steps
- [`docs/prd.md`](docs/prd.md) — MVP features, backlog
