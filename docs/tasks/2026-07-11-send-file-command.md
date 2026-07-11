# `/session send-file` command

Issue: https://github.com/hi-ogawa/acpella/issues/292

## Problem

File transfer is one-directional. User-to-agent upload works (attachments are downloaded to
`ACPELLA_UPLOAD_DIR` and the local path is embedded in the prompt), but agent replies are
text-only, so the agent cannot hand back a non-text artifact through the chat surface.

## Approach

Piggyback the existing slash-command surface instead of introducing a separate tool CLI:

```
/session send-file [--target <sessionName>] <path>
```

- Nested under `/session` rather than top-level `/send-file`: `handler.commands` metadata feeds
  Telegram `setMyCommands`, whose command names must match `[a-z0-9_]`. A hyphenated top-level
  command would either break Telegram serve startup or need to be excluded from the menu metadata.
  Nesting avoids the constraint and groups it with other session-scoped commands.
- `--target <sessionName>` follows the existing pattern (`parseSessionTarget`,
  `parseSessionCronDeliveryTarget`). Without `--target`, the current session's delivery target
  (`metadata.cronDeliveryTarget`, falling back to parsing the session name) is used.
- An agent invokes it via `acpella exec /session send-file <path> --target <sessionName>`.
  The session name is already available to the agent through the message metadata acpella
  injects into prompts, so no new environment/spawn plumbing is needed.

## Delivery seam

`CronDeliveryHandler` (`src/lib/cron/runner.ts`) is the existing delivery abstraction: serve
modes register live senders into a set in `cli.ts`; exec mode leaves it empty. Changes:

- Extend the handler payload `{ target, text }` with optional `files?: string[]` (local paths).
- `createHandler` gains a required `delivery: { send }` option; `cli.ts` passes the same
  fan-out function that `CronRunner` already uses.
- Discord serve handler: `channel.send({ content: text || undefined, files })`.
- Telegram serve handler: throws "not supported" when files are present (follow-up:
  `sendDocument`).
- Exec mode registers a handler that sends via the Discord REST API
  (`POST /channels/{id}/messages`, multipart, bot token from env config) — a short-lived
  process needs no gateway connection to send. Repl targets print the file path.
- The type keeps its `CronDeliveryHandler` name for now; renaming to a general delivery type
  is deferred to avoid churn.

## Known limitations (accepted for v1)

- Paths cannot contain whitespace (command tokens split on whitespace).
- Discord attachment size cap (10MB default, higher with boosts) is not pre-checked; the API
  error is surfaced loudly instead.
- Delivery handlers filter by surface, so a target for a surface not registered in the current
  process is silently dropped (pre-existing cron behavior; e.g. a telegram target sent from a
  discord serve process). Exec mode covers discord/repl and throws for telegram.
- No caption argument; can be added later as `-- <text...>`.

## Files

- `src/lib/cron/runner.ts` — extend `CronDeliveryHandler` payload
- `src/handler.ts` — `delivery` option + `/session send-file` command
- `src/cli.ts` — shared delivery fan-out, serve handler file support, exec REST handler
- `src/lib/discord/file.ts` — `sendDiscordMessageViaRest`
- `src/test/tester.ts`, `src/test/handler.test.ts` — delivery capture + command tests
- `skills/acpella/SKILL.md`, `skills/acpella/references/channels/discord.md` — docs
