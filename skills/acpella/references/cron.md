# Cron

Use this reference for scheduled prompts in acpella.

## What cron is for

Cron lets acpella send a prompt to a target conversation on a schedule. This is useful for recurring reminders, recurring checks, or automated prompts tied to a specific chat or thread.

If a cron agent response is exactly `NO_REPLY` after trimming whitespace, acpella treats the run as successful and suppresses outbound delivery. Use this for scheduled checks that should stay silent when there is nothing actionable to report, while still allowing failures to surface through cron error delivery. This convention is cron-only; interactive replies still deliver ordinary `NO_REPLY` text.

## Main commands

Use:

- `/cron status`
- `/cron start`
- `/cron stop`
- `/cron add <id> <minute> <hour> <day-of-month> <month> <day-of-week> [--once] [--target <sessionName>] -- <prompt...>`
- `/cron update <id> <minute> <hour> <day-of-month> <month> <day-of-week> [--target <sessionName>] [-- <prompt...>]`
- `/cron list [--compact]`
- `/cron show <id>`
- `/cron enable <id>`
- `/cron disable <id>`
- `/cron delete <id>`

## Adding jobs

The prompt must come after a literal `--` separator.

When running `/cron add` through a shell with `acpella exec`, quote the full slash command. Cron fields commonly contain `*`, and unquoted `*` can expand to filenames before acpella sees the command.

When adding a cron job from local shell administration, always provide `--target <sessionName>` so scheduled output can be delivered to Telegram:

```bash
acpella exec '/cron add morning-check 0 9 * * 1-5 --target tg-123456789 -- Check the project state and report anything urgent.'
```

`acpella exec` runs in a separate short-lived acpella process. Add, update, enable, disable, and delete commands still write the shared cron file, and the running Telegram service should pick those file changes up automatically when its cron runner is active.

For Telegram topics, the session name includes the thread id:

```bash
acpella exec '/cron add topic-check 30 8 * * * --target tg-123456789-42 -- Send the morning topic summary.'
```

The session must already exist in acpella state. Use `acpella exec /session list` to find known session names. If the list does not clearly identify a single intended destination, ask the user to confirm the session before adding, deleting, or recreating the cron job.

If `/cron add` is issued inside the Telegram conversation where the job should deliver, `--target` can be omitted because acpella can capture the current Telegram delivery target. Agents operating through local `exec` should not rely on that implicit capture.

## One-shot jobs

Add `--once` to make a job self-disable after its first execution, whether the run succeeds or fails. The job remains in state for history and debugging but will not fire again until manually re-enabled.

`--once` and `--target` can appear in either order before the `--` separator.

```bash
acpella exec '/cron add remind-deploy 0 14 5 * * --once --target tg-123456789 -- Remind the team to deploy the release.'
```

After the job fires, `/cron show remind-deploy` will show `once: yes` and `/cron list` will show `[disabled, once]`. Use `/cron enable remind-deploy` to arm it again for another single run.

## Common workflow

1. Find the target session with `acpella exec /session list` if creating the job from local shell administration; if more than one candidate could match, confirm with the user before continuing.
2. Add the job with `acpella exec '/cron add ... --target <sessionName> -- <prompt...>'` for actual Telegram delivery.
3. Check it with `/cron show <id>`, `/cron list`, or `/cron list --compact` for a timeline-style summary sorted by next run.
4. Use `/cron update <id> <minute> <hour> <day-of-month> <month> <day-of-week> ...` to change its schedule, destination, or prompt.
5. Use `/cron disable <id>` when you want to pause it.
6. Use `/cron enable <id>` to resume it.
7. Use `/cron delete <id>` to remove it entirely.

## Updating jobs

`/cron update` always requires all five cron fields. Omitted `--target` and prompt values keep their existing values. Prompt updates must come after a literal `--` separator.

When running `/cron update` through a shell with `acpella exec`, quote the full slash command if the schedule contains `*`.

Update schedule:

```bash
acpella exec '/cron update morning-check 0 10 * * 1-5'
```

Update destination while keeping the same schedule by repeating the current five cron fields:

```bash
acpella exec '/cron update morning-check 0 10 * * 1-5 --target tg-123456789'
```

Update prompt while keeping the same schedule by repeating the current five cron fields:

```bash
acpella exec '/cron update morning-check 0 10 * * 1-5 -- Check the project state and report anything urgent.'
```

Update schedule, destination, and prompt together:

```bash
acpella exec '/cron update morning-check 0 10 * * 1-5 --target tg-123456789 -- Check the project state and report anything urgent.'
```

If updating `--target` from `/session list` output, ask the user to confirm when the intended destination is not obvious. To change a job id, delete the old job and add a new one.

## Scheduler control

Cron runner state is process-local. See the main skill's command process scope before using `/cron start` or `/cron stop`.

Use these commands in the acpella process whose cron runner should be inspected or controlled:

- `/cron status` to see whether that process's cron runner is active
- `/cron start` to start that process's cron runner
- `/cron stop` to stop that process's cron runner

Cron job definition changes made through `acpella exec '/cron add ...'`, `acpella exec '/cron update ...'`, or direct edits to `.acpella/cron.json` write shared state. A live acpella process with an active cron runner reloads those file changes automatically.

## If cron is not behaving as expected

Continue with [troubleshooting.md](troubleshooting.md), especially for service logs, cron runner state, or missing deliveries.
