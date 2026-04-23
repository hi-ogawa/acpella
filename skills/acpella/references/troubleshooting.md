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

If the problem is about installing or managing the service, continue with `systemd.md`.

## Session or agent confusion

Useful commands:

- `/status`
- `/session current`
- `/session list`
- `/agent list`

If needed, reset with:

```bash
/session new
```

For the general workflows behind those commands, continue with `sessions-and-agents.md`.

## Prompt customization not taking effect

Check:

- does `.acpella/AGENTS.md` exist in the active `ACPELLA_HOME`?
- did you start a fresh session after changing it?

Remember:

- customization is applied on new sessions
- include and directive lines must be whole lines, not inline text

For the customization model, continue with `customization.md`.

## Cron issues

Useful commands:

- `/cron status`
- `/cron list`
- `/cron show <id>`

Typical checks:

- is the cron runner started?
- is the job enabled?
- is the job targeting the expected conversation?

For the command workflow itself, continue with `cron.md`.

## When deeper inspection is needed

If the public docs and command outputs do not explain the problem, inspect:

- `.acpella/state.json`
- `.acpella/cron.json`
- `.acpella/cron-state.json`
- `.acpella/logs/acp/<agentKey>/<agentSessionId>.jsonl`

At that point the task has usually moved from normal usage into implementation or runtime debugging.
