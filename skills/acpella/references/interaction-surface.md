# Interaction Surface

Use this reference for user-visible commands, message routing, and which behaviors are handled locally versus sent to the agent.

## Routing split

The main distinction in `src/handler.ts` is:

- local service commands handled inside acpella
- normal prompt text forwarded to the selected ACP agent

Relevant source:

- `src/handler.ts`

## Prompt path

For non-command text:

- acpella may prepend `<message_metadata>` when timestamp metadata is available
- it creates or loads an ACP session
- it may prepend the first prompt from `.acpella/AGENTS.md` on new sessions
- it forwards the resulting prompt to the agent
- it streams agent text chunks back through the reply manager
- it optionally shows tool-call titles when verbose mode is on

Primary anchors:

- `src/handler.ts`
- `src/lib/prompt.ts`
- `src/lib/reply.ts`

## Local commands

The command groups currently exposed through `src/handler.ts` are:

- `/status`
- `/service ...`
- `/cancel`
- `/session ...`
- `/agent ...`
- `/cron ...`
- `/verbose ...`
- `/help`

Read `src/handler.ts` for current command definitions and help strings.

## Command families

### Session

Session commands manage the mapping between a messaging conversation and an ACP session:

- show current session
- list known sessions
- create a new session
- load an existing ACP session
- close an ACP session mapping

### Agent

Agent commands manage configured ACP agent launch commands:

- list agents
- register a new agent
- remove an agent
- show or set the default agent

### Cron

Cron commands manage scheduled prompts:

- scheduler status
- start / stop / reload
- list / show jobs
- enable / disable / delete jobs

### Verbose

Verbose commands control whether tool-call titles are surfaced to the user during a prompt.

## Good source pairs

- Command behavior: `src/handler.ts`
- Command expectations and snapshots: `src/handler.test.ts`
- Usage/help rendering for grouped commands: `src/lib/command.ts` and `src/lib/command.test.ts`
