# Cron

Use this reference for scheduled prompts in acpella.

## What cron is for

Cron lets acpella send a prompt to a target conversation on a schedule. This is useful for recurring reminders, recurring checks, or automated prompts tied to a specific chat or thread.

## Main commands

Use:

- `/cron status`
- `/cron start`
- `/cron stop`
- `/cron reload`
- `/cron add <id> <minute> <hour> <day-of-month> <month> <day-of-week> <prompt...>`
- `/cron list`
- `/cron show <id>`
- `/cron enable <id>`
- `/cron disable <id>`
- `/cron delete <id>`

## Common workflow

1. Add a job in the conversation where it should deliver.
2. Check it with `/cron show <id>` or `/cron list`.
3. Use `/cron disable <id>` when you want to pause it.
4. Use `/cron enable <id>` to resume it.
5. Use `/cron delete <id>` to remove it entirely.

## Scheduler control

Use:

- `/cron status` to see whether the runner is active
- `/cron start` to start it
- `/cron stop` to stop it
- `/cron reload` after editing cron state on disk or when you need acpella to refresh its in-memory view

## If cron is not behaving as expected

Continue with `troubleshooting.md`, especially for service logs, cron runner state, or missing deliveries.
