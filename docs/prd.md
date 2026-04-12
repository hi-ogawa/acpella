# TODO

- [ ] feat: telegram integration
  - [x] Receive text messages, reply with agent response
  - [x] Sender allowlist (user + chat)
  - [x] Long message splitting (Telegram 4096 char limit)
  - [ ] Chat/thread → named session mapping
  - [ ] Typing indicator while agent is working
    - Keep sending Telegram chat action during long gaps where no text/tool updates are flushed
  - [ ] Markdown formatting (Telegram MarkdownV2)
- [ ] feat: session lifecycle
  - [ ] Daily refresh — close and recreate session at configurable hour
  - [ ] Session-per-thread — verify acpx handles named sessions correctly
- [ ] perf: warmed agent process/session cache
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
- [ ] test: rework startService helper

## Backlog

- [ ] feat: channel agnostic
