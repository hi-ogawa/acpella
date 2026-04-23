# Bootstrap

Use this reference for first-time setup and initial local runs of acpella.

Primary source:

- `README.md`

## Basic setup

```bash
git clone https://github.com/hi-ogawa/acpella
cd acpella
pnpm install
cp .env.example .env
```

After copying `.env`, edit it using the config section in `README.md`.

## Main config knobs

The most important environment variables documented in `README.md` are:

- `ACPELLA_TELEGRAM_BOT_TOKEN`
- `ACPELLA_TELEGRAM_ALLOWED_USER_IDS`
- `ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS`
- `ACPELLA_HOME`

`ACPELLA_HOME` defaults to `process.cwd()` when unset.

Implementation anchor:

- `src/config.ts`

## First local runs

Run the Telegram bot:

```bash
pnpm cli
```

Run the local REPL:

```bash
pnpm repl
```

## Agent bootstrap after startup

The built-in default agent is the test echo agent. To register a real ACP agent after startup, use the acpella command surface, for example:

```bash
/agent new codex codex-acp
/agent default codex
```

Source:

- `README.md`

## When to read deeper docs

- For runtime architecture, continue with `runtime-model.md`.
- For systemd installation and service management, continue with `systemd.md`.
- For prompt customization through `.acpella/AGENTS.md`, continue with `prompt-and-skills.md`.
