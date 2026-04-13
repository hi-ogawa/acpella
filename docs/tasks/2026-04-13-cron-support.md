# Cron Support for Scheduled Agent Turns

## Problem Context And Approach

Issue: acpella needs first-class cron support so scheduled workflows can run without relying on external prompting.

The implementation adds:

1. **Cron definitions** persisted in `.acpella/cron.json`.
2. **Cron state** (last run, duplicate prevention) in `.acpella/cron-state.json`.
3. **Scheduler loop** polling every 60 s, firing due jobs.
4. **Trigger metadata** injected as `<trigger_metadata>` into the agent prompt.
5. **Telegram delivery** via `bot.api.sendMessage` (no `reply_to_message_id`).
6. **`/cron` Telegram command** for agent management (list, run-now, next-runs).

## Reference Files

- `src/lib/cron.ts` — CronEntry/CronState schemas, file I/O, next-run-time helpers (croner).
- `src/lib/cron-scheduler.ts` — Scheduler, firing logic, overlapping-run protection, Telegram delivery.
- `src/lib/cron.test.ts` — Unit tests for schema, file I/O, and next-run-time computation.
- `src/config.ts` — Added `cronFile` and `cronStateFile` paths.
- `src/handler.ts` — Added `/cron list|run|next` command handler + `cronScheduler` option.
- `src/cli.ts` — Creates `CronScheduler` and passes to handler; calls `cronScheduler.start()`.

## cron.json Format

```json
[
  {
    "id": "daily-routine-morning",
    "name": "Morning routine",
    "enabled": true,
    "schedule": "0 8 * * *",
    "timezone": "Asia/Tokyo",
    "prompt": "Follow the morning step in the daily-routine skill.",
    "target": {
      "surface": "telegram",
      "chat_id": "123456789",
      "session_id": "<acp-session-id>"
    },
    "delivery": {
      "mode": "send_message",
      "quiet_hours": true
    }
  }
]
```

`chat_id` is the raw numeric Telegram chat ID as a string.
`session_id` is the ACP session ID that will be loaded for each run.

## Trigger Metadata Format

```xml
<trigger_metadata>
trigger: cron
cron_id: daily-routine-morning
scheduled_for: 2026-04-13T08:00:00.000Z
fired_at: 2026-04-13T08:00:02.000Z
timezone: Asia/Tokyo
surface: telegram
chat_type: dm
</trigger_metadata>
```

## Safety Defaults

- No overlapping runs per cron ID (in-memory `activeRuns` set).
- Persistent duplicate prevention: run key `${cronId}:${scheduledFor.toISOString()}` is written to `cron-state.json` before the agent turn starts.
- Cron entries are disabled by default unless `enabled: true`.
- `cron.json` is re-read on every poll tick, so changes take effect within 60 s.

## Telegram Commands

```
/cron list              — list all cron jobs with status and next run time
/cron run <id>          — fire a cron job immediately
/cron next <id> [n]     — show next N scheduled run times (default 5, max 20)
```

## Dependencies Added

- `croner@10.0.1` — zero-dependency cron expression parser + next-run-time calculator using native `Intl`.
