# acpella

Thin daemon that connects a messaging channel (Telegram) to a coding agent via [ACP](https://github.com/agentclientprotocol/agent-client-protocol). Agent-agnostic — works with Codex, Claude Code, or any ACP-compatible agent.

## Setup

```bash
pnpm install
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN and ALLOWED_USER_IDS
```

## Run

```bash
pnpm start        # run daemon
pnpm dev          # run with --watch
```

## Config

| Variable             | Required | Default         | Description                                |
| -------------------- | -------- | --------------- | ------------------------------------------ |
| `TELEGRAM_BOT_TOKEN` | yes      | —               | Bot token from @BotFather                  |
| `ALLOWED_USER_IDS`   | yes      | —               | Comma-separated numeric Telegram user IDs  |
| `ALLOWED_CHAT_IDS`   | no       | —               | Comma-separated chat IDs (group allowlist) |
| `AGENT`              | no       | `codex`         | acpx agent name                            |
| `DAEMON_CWD`         | no       | `process.cwd()` | Agent working directory                    |

## Docs

- [`docs/architecture.md`](docs/architecture.md) — design decisions, data flow
- [`docs/deploy.md`](docs/deploy.md) — systemd unit, install steps
- [`docs/prd.md`](docs/prd.md) — MVP features, backlog
