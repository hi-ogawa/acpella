# acpella

Thin service that connects a messaging channel (Telegram) to AI agent via [ACP](https://github.com/agentclientprotocol/agent-client-protocol). Agent-agnostic — works with Codex, Claude Code, or any ACP-compatible agent.

## Setup

```bash
pnpm install
cp .env.example .env
# fill in ACPELLA_TELEGRAM_BOT_TOKEN and ACPELLA_TELEGRAM_ALLOWED_USER_IDS
```

## Run

```bash
pnpm cli        # run service
pnpm cli --repl # run local in-process REPL
```

## Config

| Variable                            | Required | Default         | Description                                |
| ----------------------------------- | -------- | --------------- | ------------------------------------------ |
| `ACPELLA_TELEGRAM_BOT_TOKEN`        | yes      | —               | Bot token from @BotFather                  |
| `ACPELLA_TELEGRAM_ALLOWED_USER_IDS` | yes      | —               | Comma-separated numeric Telegram user IDs  |
| `ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS` | no       | —               | Comma-separated chat IDs (group allowlist) |
| `ACPELLA_AGENT`                     | no       | `test`          | acp agent command                          |
| `ACPELLA_HOME`                      | no       | `process.cwd()` | Agent working directory                    |

The default `ACPELLA_AGENT=test` uses the built-in echo agent. Set `ACPELLA_AGENT` to any ACP agent
command to use a real agent. Known ACP agents are listed in the
[ACP agent registry](https://agentclientprotocol.com/get-started/registry).

For Codex ACP, either install `@zed-industries/codex-acp` globally and set:

```env
ACPELLA_AGENT=codex-acp
```

Or run it through `npx`:

```env
ACPELLA_AGENT="npx -y @zed-industries/codex-acp"
```

If `$ACPELLA_HOME/.acpella/AGENTS.md` exists, its contents are sent as custom instructions once when creating a new session.

## Docs

- [`docs/architecture.md`](docs/architecture.md) — design decisions, data flow
- [`docs/deploy.md`](docs/deploy.md) — systemd unit, install steps
- [`docs/prd.md`](docs/prd.md) — MVP features, backlog
