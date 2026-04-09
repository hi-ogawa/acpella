# PRD

What the daemon needs to be usable as an OpenClaw replacement for daily use.

## MVP features

### 1. Telegram

- [x] Receive text messages, reply with agent response
- [x] Sender allowlist (user + chat)
- [x] Chat/thread → named session mapping
- [ ] Typing indicator while agent is working
- [ ] Long message splitting (Telegram 4096 char limit)
- [ ] Markdown formatting (Telegram MarkdownV2)

### 2. Session lifecycle

- [ ] Daily refresh — close and recreate session at configurable hour
- [ ] Session-per-thread — verify acpx handles named sessions correctly
- [ ] Graceful shutdown — close active sessions on SIGTERM

### 3. System commands

Deterministic handlers, no agent involved:

- [ ] `/status` — daemon running, active sessions
- [ ] `/sessions` — list acpx sessions
- [ ] `/pause` / `/resume` — stop/start processing messages

### 4. Error handling

- [ ] Timeout — reply with error if acpx doesn't respond in 5 min
- [ ] Queue — if message arrives while one is processing, queue it

## Non-goals

- Multi-agent
- Web dashboard
- Database
- Voice / media handling

## TODO

- [ ] fix: Named acpx session not working — investigate `acpx sessions ensure --name`
- [ ] fix: In-flight message can be dropped when `pnpm dev` auto-restarts during processing
- [ ] refactor: env config util
- [ ] refactor: child process exec util

## Backlog

### Cron

- Config file with scheduled prompts (JSON or YAML)
- Poll loop — check schedule every 60s, fire due prompts into sessions
- Target session — cron jobs specify which session
- Run log — log each execution result
