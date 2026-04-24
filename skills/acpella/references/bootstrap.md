# Bootstrap

Use this reference for first-time setup and initial local runs of acpella.

## Basic setup

```bash
git clone https://github.com/hi-ogawa/acpella
cd acpella
pnpm install
cp .env.example .env
```

After copying `.env`, edit the main config values below.

## Main config knobs

The most important environment variables are:

- `ACPELLA_TELEGRAM_BOT_TOKEN`
- `ACPELLA_TELEGRAM_ALLOWED_USER_IDS`
- `ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS`
- `ACPELLA_HOME`

`ACPELLA_HOME` defaults to `process.cwd()` when unset.

## First local runs

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

The built-in default agent is the test echo agent. Register a real ACP agent with the command surface, for example:

```bash
pnpm cli exec /agent new codex codex-acp
pnpm cli exec /agent default codex
```

## Next steps

- For systemd installation and service management, continue with `systemd.md`.
- For prompt customization through `.acpella/AGENTS.md`, continue with `customization.md`.
- For session and agent workflows, continue with `sessions-and-agents.md`.
