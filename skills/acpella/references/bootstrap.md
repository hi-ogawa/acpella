# Bootstrap

Use this reference for first-time setup and initial local runs of acpella.

## Basic setup

Clone the source from https://github.com/hi-ogawa/acpella:

```bash
git clone https://github.com/hi-ogawa/acpella
cd acpella
pnpm install
cp .env.example .env
```

After copying `.env`, edit the main config values below.

## Config

| Variable                            | Default         | Description                                  |
| ----------------------------------- | --------------- | -------------------------------------------- |
| `ACPELLA_TELEGRAM_BOT_TOKEN`        | -               | Bot token from @BotFather                    |
| `ACPELLA_TELEGRAM_ALLOWED_USER_IDS` | -               | Comma-separated numeric Telegram user IDs    |
| `ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS` | -               | Comma-separated chat IDs for group allowlist |
| `ACPELLA_HOME`                      | `process.cwd()` | Agent working directory                      |

Notes:

- Telegram configuration is not required for `pnpm repl`.
- If `ACPELLA_HOME/.acpella/AGENTS.md` exists, acpella sends it as custom instructions once when creating a new session.

## First local runs

Run these from the acpella source checkout.

Run the Telegram bot:

```bash
pnpm cli
```

Run the local REPL:

```bash
pnpm repl
```

Run one local administrative slash command:

```bash
pnpm cli exec /status
```

Use `exec` for acpella administration, not for normal agent prompts.

## Register a real agent

The built-in default agent is the test echo agent. Acpella does not install ACP agent adapters for you; `/agent new` stores the command that acpella will later spawn.

For Codex ACP without a global install, register the adapter through `npx`:

```bash
pnpm cli exec /agent new codex npx -y @zed-industries/codex-acp
pnpm cli exec /agent default codex
```

If `codex-acp` is already installed and available on the same `PATH` used by acpella, you can register `codex-acp` directly instead:

```bash
npm i -g @zed-industries/codex-acp
pnpm cli exec /agent new codex codex-acp
```

Other known ACP agents are listed in the ACP agent registry: https://agentclientprotocol.com/get-started/registry

## Next steps

- For systemd installation and service management, continue with [systemd.md](systemd.md).
- For prompt customization through `.acpella/AGENTS.md`, continue with [customization.md](customization.md).
- For session and agent management, continue with [sessions-and-agents.md](sessions-and-agents.md).
