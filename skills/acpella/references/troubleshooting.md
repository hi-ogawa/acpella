# Troubleshooting

Use this reference when acpella is not doing what the user expects.

## Start with the symptom

Most problems fall into one of these buckets:

- service is not running
- Telegram or REPL prompts are not reaching the agent
- the wrong session or wrong agent is active
- prompt customization is not taking effect
- cron jobs are not running or not delivering

## Service issues

If acpella itself may be down, start with:

```bash
journalctl --user -u acpella -f
```

If the problem is about installing or managing the service, continue with [systemd.md](systemd.md).

## Session or agent confusion

Useful commands:

- `/status`
- `/session list`
- `/agent list`

If needed, reset with:

```bash
/session new
```

Run this in the target Telegram or REPL conversation. Do not use `acpella exec` for `/session new`.

For the general workflows behind those commands, continue with [sessions-and-agents.md](sessions-and-agents.md).

For installation-wide checks from a local shell, prefer:

```bash
acpella exec /status
acpella exec /agent list
```

Run these with the same installed `acpella` command or `--env-file` used by the running service.

## Prompt customization not taking effect

Check:

- does `.acpella/AGENTS.md` exist in the active `ACPELLA_HOME`?
- did you start a fresh session after changing it?

Remember:

- customization is applied on new sessions
- include and directive lines must be whole lines, not inline text

For the customization model, continue with [customization.md](customization.md).

## Cron issues

Useful commands:

- `/cron status`
- `/cron list`
- `/cron show <id>`

Typical checks:

- is the cron runner started?
- is the job enabled?
- is the job targeting the expected conversation?

For the command workflow itself, continue with [cron.md](cron.md).

For installation-wide cron checks from a local shell, prefer:

```bash
acpella exec /cron status
acpella exec /cron list
```

Run these with the same installed `acpella` command or `--env-file` used by the running service.

## When deeper inspection is needed

If the public docs and command outputs do not explain the problem, inspect:

- `.acpella/state.json`: conversation/session routing, default agent, configured agents, and per-session preferences. Use for wrong-agent, wrong-session, or missing-session problems.
- `.acpella/cron.json`: durable cron job definitions: ids, enabled flags, schedules, prompts, target sessions, and delivery targets. Use for cron setup or destination problems.
- `.acpella/cron-state.json`: cron run history and latest run status. Use for missed, failed, or duplicate scheduled runs.
- `.acpella/logs/acp/<agentKey>/<agentSessionId>.jsonl`: raw ACP exchange logs for one agent session. Use when the command layer looks correct but the agent failed, hung, or returned unexpected output.

At that point the task has usually moved from normal usage into implementation or runtime debugging.
