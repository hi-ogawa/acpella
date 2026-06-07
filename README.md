# acpella

Thin service that connects a messaging channel (Telegram) to AI agent via [ACP](https://github.com/agentclientprotocol/agent-client-protocol). Agent-agnostic — works with [OpenCode](https://github.com/anomalyco/opencode), [Codex](https://github.com/zed-industries/codex-acp/), or any [ACP-compatible agent](https://agentclientprotocol.com/get-started/agents).

## Setup

```bash
npm install -g github:hi-ogawa/acpella
```

See [`skills/acpella`](skills/acpella/SKILL.md) for setup, configuration, deployment, agent registration, systemd, cron, and troubleshooting workflows.

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
