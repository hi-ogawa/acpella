# TODO

- [ ] feat: telegram Markdown formatting (Telegram MarkdownV2)
- [ ] feat: cron
  - Config file with scheduled prompts (JSON or YAML)
  - Poll loop — check schedule every 60s, fire due prompts into sessions
  - Target session — cron jobs specify which session
  - Run log — log each execution result
- [ ] feat: session lifecycle
  - [ ] Daily refresh — close and recreate session at configurable hour
  - [ ] Session-per-thread — verify acpx handles named sessions correctly
- [ ] feat: telegram Typing indicator while agent is working
  - Keep sending Telegram chat action during long gaps where no text/tool updates are flushed
- [ ] feat: reply stream idle flush
  - Flush buffered stream text after a short idle timeout when no follow-up write or finish arrives
  - Notes: `docs/tasks/2026-04-14-openclaw-reply-streaming-notes.md`

## Backlog

- [ ] feat: channel agnostic
- [ ] feat: heartbeat
- [ ] perf: warmed agent process/session cache
- [ ] chore: publish npm package, executable
- [ ] fix: handle timeout — abort and reply with error if agent doesn't respond in 5 min
