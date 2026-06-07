# Bootstrap

Use this reference for first-time setup and initial local runs of acpella.

## Basic setup

Install acpella globally from GitHub:

```bash
npm install -g github:hi-ogawa/acpella
mkdir -p ~/.config/acpella
${EDITOR:-vi} ~/.config/acpella/.env
```

After creating `.env`, set the main config values below.

## Config

| Variable                              | Default         | Description                                  |
| ------------------------------------- | --------------- | -------------------------------------------- |
| `ACPELLA_TELEGRAM_BOT_TOKEN`          | -               | Bot token from @BotFather                    |
| `ACPELLA_TELEGRAM_ALLOWED_USER_IDS`   | -               | Comma-separated numeric Telegram user IDs    |
| `ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS`   | -               | Comma-separated chat IDs for group allowlist |
| `ACPELLA_DISCORD_BOT_TOKEN`           | -               | Discord bot token                            |
| `ACPELLA_DISCORD_ALLOWED_GUILD_IDS`   | -               | Comma-separated Discord server IDs           |
| `ACPELLA_DISCORD_ALLOWED_USER_IDS`    | -               | Optional comma-separated Discord user IDs    |
| `ACPELLA_DISCORD_ALLOWED_CHANNEL_IDS` | -               | Optional comma-separated Discord channel IDs |
| `ACPELLA_HOME`                        | `process.cwd()` | Agent working directory                      |

Notes:

- Telegram and Discord configuration are not required for `acpella repl`.
- For Telegram setup details, see [channels/telegram.md](channels/telegram.md).
- For Discord setup details, see [channels/discord.md](channels/discord.md).
- If `ACPELLA_HOME/.acpella/AGENTS.md` exists, acpella sends it as custom instructions once when creating a new session.

## First local runs

Run these after installing the global CLI.

Run the Telegram bot:

```bash
acpella serve
```

Run the Discord bot:

```bash
acpella serve --channel=discord
```

When running Telegram and Discord as separate service processes, run cron in only one of them:

```bash
acpella serve --channel=telegram
acpella serve --channel=discord --no-cron
```

Run the local REPL:

```bash
acpella repl
```

Run one local administrative slash command:

```bash
acpella exec /status
```

Use `exec` for acpella administration, not for normal agent prompts.

## Register a real agent

The built-in default agent is the test echo agent. Acpella does not install ACP agent adapters for you; `/agent new` stores the command that acpella will later spawn.

For Codex ACP without a global install, register the adapter through `npx`:

```bash
acpella exec /agent new codex npx -y @zed-industries/codex-acp
acpella exec /agent default codex
```

If `codex-acp` is already installed and available on the same `PATH` used by acpella, you can register `codex-acp` directly instead:

```bash
npm i -g @zed-industries/codex-acp
acpella exec /agent new codex codex-acp
```

Other known ACP agents are listed in the ACP agent registry: https://agentclientprotocol.com/get-started/registry

## Next steps

- For systemd installation and service management, continue with [systemd.md](systemd.md).
- For prompt customization through `.acpella/AGENTS.md`, continue with [customization.md](customization.md).
- For session and agent management, continue with [sessions-and-agents.md](sessions-and-agents.md).
