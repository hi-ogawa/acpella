# TODO

- [x] chore: replace "daemon" with "service"
- [ ] feat: telegram integration
  - [x] Receive text messages, reply with agent response
  - [x] Sender allowlist (user + chat)
  - [ ] Chat/thread → named session mapping
  - [ ] Typing indicator while agent is working
    - Keep sending Telegram chat action during long gaps where no text/tool updates are flushed
  - [ ] Markdown formatting (Telegram MarkdownV2)
  - [ ] Long message splitting (Telegram 4096 char limit)
- [ ] feat: session lifecycle
  - [ ] Daily refresh — close and recreate session at configurable hour
  - [ ] Session-per-thread — verify acpx handles named sessions correctly
- [x] fix: Named acpx session not working — was arg placement: `-s` is a `prompt` subcommand option, not `codex`
- [ ] feat: system prompt (just use AGENTS.md convention)
- [ ] feat: system commands
  - [x] status
  - [x] session current/list/new/load/close
- [ ] refactor: env config util
- [ ] refactor: child process exec util
  - [x] debug log
- [ ] perf: warmed agent process/session cache
- [ ] chore: dog-fooding
  - In-flight message can be dropped when `pnpm dev` auto-restarts during processing
- [x] test: test repl mode with toy acp
- [x] test: test repl mode with codex
- [ ] fix: handle timeout — reply with error if acpx doesn't respond in 5 min
  - Important for streaming because a partially delivered response can otherwise hang without a terminal message
- [ ] fix: queue — if message arrives while one is processing, queue it
  - Required before streaming responses can be considered robust; concurrent prompts in the same session must not interleave replies
- [ ] feat: cron
  - Config file with scheduled prompts (JSON or YAML)
  - Poll loop — check schedule every 60s, fire due prompts into sessions
  - Target session — cron jobs specify which session
  - Run log — log each execution result
- [ ] feat: heartbeat
- [ ] feat: make session selectable on repl mode

## Backlog

- [ ] feat: channel agnostic
