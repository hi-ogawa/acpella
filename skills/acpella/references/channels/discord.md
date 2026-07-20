# Discord Channel

Use this reference for a lightweight Discord setup for `acpella serve`.

## Discord App

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. Add a bot to the application.
3. Optionally disable Public Bot so only you can invite it to guilds. The guild allowlist below is the actual safety boundary; this just keeps strangers from adding your bot to their servers. If the portal rejects the toggle, first set Install Link to None (and uncheck User Install) in the Installation tab.
4. In the bot settings, enable the Message Content privileged intent. Acpella reads normal Discord text from `message.content`.
5. Copy the bot token for `ACPELLA_DISCORD_BOT_TOKEN`.
6. Invite the bot to your private server: in the OAuth2 tab's URL Generator, check the `bot` scope and these basic permissions, then open the generated authorize URL in a browser and pick the server (requires Manage Server there):
   - View Channels
   - Send Messages
   - Send Messages in Threads
   - Read Message History

## IDs

Enable Developer Mode in Discord, then copy IDs from the context menu:

- Server ID: right-click the server, then copy the server ID.
- User ID: right-click yourself, then copy the user ID.
- Channel ID: right-click a channel, then copy the channel ID.

## Environment

For a private-server setup, require the guild allowlist and keep user/channel allowlists optional:

```env
ACPELLA_DISCORD_BOT_TOKEN=...
ACPELLA_DISCORD_ALLOWED_GUILD_IDS=123456789012345678

# Optional extra filters
ACPELLA_DISCORD_ALLOWED_USER_IDS=123456789012345678
ACPELLA_DISCORD_ALLOWED_CHANNEL_IDS=123456789012345678
```

`ACPELLA_DISCORD_ALLOWED_GUILD_IDS` is the main safety boundary. It also rejects direct messages because DMs have no guild id. Use `ACPELLA_DISCORD_ALLOWED_USER_IDS` or `ACPELLA_DISCORD_ALLOWED_CHANNEL_IDS` only when the allowed server has extra people or channels that should not reach acpella.

## Run

Discord is enabled for `acpella serve` when `ACPELLA_DISCORD_BOT_TOKEN` is set.

```bash
acpella serve
```

## Forum-Post Sessions

Use `/discord new-session` to branch a task into its own forum post while working in a channel or another post. The post becomes a fresh acpella session with the post body as its first prompt, so the new session starts working on the handoff immediately, stays visible in Discord, and the user can guide it there directly. The command replies with the post URL and the session name (`discord:<thread-id>`) for follow-ups such as `--target`.

```text
/discord new-session <forum-channel-id> <title...> -- <text>
```

The `/discord` command group exists only when `ACPELLA_DISCORD_BOT_TOKEN` is configured.

Usage notes:

- The text after `--` is taken verbatim, so multi-line handoffs keep their formatting. Through `acpella exec`, quote the whole command argument to preserve newlines.
- Discord caps the post body at 2000 characters. Keep it a readable summary of the task; for deep context, write a tmp file and reference its path in the handoff — the new session's agent picks it up through its own tmp-file convention.
- Agents cannot discover forum ids on their own. To let an agent branch subtasks into posts, put the forum id and spawn policy in `ACPELLA_HOME/.acpella/AGENTS.md`, for example: "To branch a subtask into its own session, run `acpella exec /discord new-session <forum-channel-id> <title> -- <handoff>` with a written handoff (context, stop conditions, mutation boundaries). Spawn deliberately."

## Sending Prompts to Existing Sessions

Use `/discord send-message` to post a visible prompt to an existing Discord channel or thread session. The command sends the message through Discord REST, then the running Discord Gateway service receives the marked bot message and processes it through the target session's normal prompt queue.

```text
/discord send-message <channel-id> -- <text>
```

The text after `--` is preserved verbatim, including newlines. Through `acpella exec`, quote the whole command argument to preserve them. The target uses the same guild and channel allowlists as inbound messages, including the rule that an allowlisted parent admits its threads.

## Sending Files

Use `/discord send-file` to deliver a local file (an image, a chart, a build artifact) into a channel as an attachment, since agent replies are otherwise text-only.

```text
/discord send-file <channel-id> <path>
```

The target channel (or thread) id is explicit; to send into the current conversation, take its channel id from the message context metadata (`discord:guild:<guild-id>:channel:<channel-id>`). Paths cannot contain whitespace. Discord rejects attachments over its upload size limit (10MB by default); the command surfaces the API error instead of pre-checking.
