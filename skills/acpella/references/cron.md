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
- `/cron add <id> <minute> <hour> <day-of-month> <month> <day-of-week> [--session <sessionName>] -- <prompt...>`
- `/cron list`
- `/cron show <id>`
- `/cron enable <id>`
- `/cron disable <id>`
- `/cron delete <id>`

## Adding jobs

The prompt must come after a literal `--` separator.

When running `/cron add` through a shell with `pnpm cli exec`, quote the full slash command. Cron fields commonly contain `*`, and unquoted `*` can expand to filenames before acpella sees the command.

When adding a cron job from local shell administration, always provide `--session <sessionName>` so scheduled output can be delivered to Telegram:

```bash
pnpm cli exec '/cron add morning-check 0 9 * * 1-5 --session tg-123456789 -- Check the project state and report anything urgent.'
```

For Telegram topics, the session name includes the thread id:

```bash
pnpm cli exec '/cron add topic-check 30 8 * * * --session tg-123456789-42 -- Send the morning topic summary.'
```

The session must already exist in acpella state. Use `pnpm cli exec /session list` to find known session names. If the list does not clearly identify a single intended destination, ask the user to confirm the session before adding, deleting, or recreating the cron job.

If `/cron add` is issued inside the Telegram conversation where the job should deliver, `--session` can be omitted because acpella can capture the current Telegram delivery target. Agents operating through local `exec` should not rely on that implicit capture.

## Common workflow

1. Find the target session with `pnpm cli exec /session list` if creating the job from local shell administration; if more than one candidate could match, confirm with the user before continuing.
2. Add the job with `pnpm cli exec '/cron add ... --session <sessionName> -- <prompt...>'` for actual Telegram delivery.
3. Check it with `/cron show <id>` or `/cron list`.
4. Use `/cron disable <id>` when you want to pause it.
5. Use `/cron enable <id>` to resume it.
6. Use `/cron delete <id>` to remove it entirely.

There is no edit command. To update a cron job's schedule, destination, or prompt, delete the old job and add it again:

```bash
pnpm cli exec /cron delete morning-check
pnpm cli exec '/cron add morning-check 0 10 * * 1-5 --session tg-123456789 -- Check the project state and report anything urgent.'
```

## Scheduler control

Use:

- `/cron status` to see whether the runner is active
- `/cron start` to start it
- `/cron stop` to stop it
- `/cron reload` after editing cron state on disk or when you need acpella to refresh its in-memory view

## If cron is not behaving as expected

Continue with `troubleshooting.md`, especially for service logs, cron runner state, or missing deliveries.
