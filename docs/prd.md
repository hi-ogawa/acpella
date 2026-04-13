# TODO

- [ ] feat: telegram Typing indicator while agent is working
  - Keep sending Telegram chat action during long gaps where no text/tool updates are flushed
- [ ] feat: telegram Markdown formatting (Telegram MarkdownV2)
- [ ] feat: session lifecycle
  - [ ] Daily refresh — close and recreate session at configurable hour
  - [ ] Session-per-thread — verify acpx handles named sessions correctly
- [ ] fix: handle timeout — reply with error if acpx doesn't respond in 5 min
  - Important for streaming because a partially delivered response can otherwise hang without a terminal message
- [ ] fix: queue — if message arrives while one is processing, queue it
  - Required before streaming responses can be considered robust; concurrent prompts in the same session must not interleave replies
- [ ] feat: cron
  - Config file with scheduled prompts (JSON or YAML)
  - Poll loop — check schedule every 60s, fire due prompts into sessions
  - Target session — cron jobs specify which session
  - Run log — log each execution result
- [ ] chore: publish as npm package
- [ ] refactor: review slop

## Backlog

- [ ] feat: channel agnostic
- [ ] feat: heartbeat
- [ ] perf: warmed agent process/session cache
