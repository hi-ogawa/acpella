# Bootstrap plan

Scaffold acpella as a proper TypeScript project, migrating the working prototype from `journal-private`.

## Reference

Prototype lives at:
`~/code/personal/journal-private/2026-04-06-openclaw-alternatives/prototype/`

Prior personal project conventions: `yt-dlp-ext` — pnpm, vite-plus formatting, strict tsconfig, AGENTS.md quick reference.

## Steps

### 1. package.json

```json
{
  "name": "acpella",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node --env-file=.env src/daemon.ts",
    "dev": "node --env-file=.env --watch src/daemon.ts",
    "tsc": "tsc -b",
    "lint": "vp fmt",
    "lint-check": "vp fmt --check"
  }
}
```

Dependencies:
- `grammy` — Telegram bot
- `acpx` — ACP client CLI, owned as direct dep; invoke via `./node_modules/.bin/acpx` (not npx — exact invocation TBD)

Dev dependencies:
- `typescript`
- `@types/node`
- `vite-plus` (formatting)

### 2. tsconfig.json

Node-appropriate — no DOM, NodeNext moduleResolution, strict:

```json
{
  "include": ["src"],
  "compilerOptions": {
    "verbatimModuleSyntax": true,
    "target": "esnext",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "skipLibCheck": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### 3. Source layout

Migrate and split `daemon.ts` into modules per the mvp plan:

```
src/
  daemon.ts     — entry point: bot setup, wires telegram + acpx
  telegram.ts   — grammy bot, message handler, reply helpers
  acpx.ts       — acpx interface: ensureSession, prompt, close
  config.ts     — env vars with defaults and validation
```

### 4. Docs + config files

- `AGENTS.md` — Quick Reference (commands), Key Docs (table), Architecture, Conventions, Agent Rules
- `docs/prd.md` — MVP features checklist, backlog (migrate from journal-private `notes/mvp.md`)
- `docs/background/architecture.md` — design decisions, ACP integration notes
- `.env.example` — copy from prototype, document all vars
- `.gitignore` — `node_modules/`, `.env`

### 5. Deployment

- `docs/deploy.md` — systemd unit file + install instructions
- Target: run alongside existing openclaw, same machine

```ini
# /etc/systemd/system/acpella.service
[Unit]
Description=acpella daemon
After=network.target

[Service]
Type=simple
User=%i
WorkingDirectory=/home/%i/code/personal/acpella
EnvironmentFile=/home/%i/code/personal/acpella/.env
ExecStart=/usr/bin/node src/daemon.ts
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## Order

1. `pnpm init` + add deps
2. `tsconfig.json`
3. Migrate + split source (`config.ts` → `acpx.ts` → `telegram.ts` → `daemon.ts`)
4. Verify `pnpm start` works end-to-end (Telegram round-trip)
5. `AGENTS.md` + `docs/prd.md`
6. `.env.example`, `.gitignore`
7. `docs/deploy.md` with systemd unit
