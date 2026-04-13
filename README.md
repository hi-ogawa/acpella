# acpella

Thin service that connects a messaging channel (Telegram) to AI agent via [ACP](https://github.com/agentclientprotocol/agent-client-protocol). Agent-agnostic — works with Codex, Claude Code, or any ACP-compatible agent.

## Setup and Run

```bash
pnpm install
cp .env.example .env
# edit .env using the Config section below

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

### ACPELLA_AGENT

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

Gotcha: Codex ACP reads Codex CLI configuration through its own `-c key=value` override flag.
If you want Codex to run without sandboxing, pass that through the agent command:

```env
ACPELLA_AGENT="codex-acp -c sandbox_mode=danger-full-access"
```

Check `codex-acp --help` for the current configuration override syntax before changing flags.

### `$ACPELLA_HOME/.acpella/AGENTS.md`

If this file exists, its contents are sent as custom instructions once when creating a new session.

## Docs

- [`docs/architecture.md`](docs/architecture.md) — design decisions, data flow
- [`docs/deploy.md`](docs/deploy.md) — systemd unit, install steps
- [`docs/prd.md`](docs/prd.md) — MVP features, backlog
