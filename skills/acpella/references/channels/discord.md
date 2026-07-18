# Discord Channel

Use this reference for a lightweight Discord setup for `acpella serve`.

## Discord App

1. Open the Discord Developer Portal and create an application.
2. Add a bot to the application.
3. In the bot settings, enable the Message Content privileged intent. Acpella reads normal Discord text from `message.content`.
4. Copy the bot token for `ACPELLA_DISCORD_BOT_TOKEN`.
5. Invite the bot to your private server with the `bot` scope and these basic permissions:
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

`/discord new-session` creates a Discord forum post through the Discord REST API using `ACPELLA_DISCORD_BOT_TOKEN`. The `/discord` command group is registered only when the token is configured, so `/help` reflects whether it is available.

```text
/discord new-session <forum-channel-id> <title...> -- <text>
```

The command replies with the created post URL and its session name (`discord:<thread-id>`).

Because a forum post is a thread channel, it becomes a normal acpella session like any human-created post. As a Discord-specific bonus, the post body is processed as that session's first prompt: the running service admits the bot's own thread starter message (the one message whose id equals its thread id) through the normal message path, while every other bot-authored message stays ignored. The starter still requires an allowed guild, and an allowlisted parent channel admits its threads when `ACPELLA_DISCORD_ALLOWED_CHANNEL_IDS` is set.

Usage notes:

- The text after `--` is taken verbatim, so multi-line handoffs keep their formatting. Through `acpella exec`, quote the whole command argument to preserve newlines.
- Discord caps the post body at 2000 characters. Keep it a readable summary of the task, and put deep context in a file under `ACPELLA_HOME` referenced by path, since the new session's agent runs on the same machine.
- The auto-prompt relies on the running `acpella serve` gateway connection. Through `acpella exec` the post is still created if the service is down, but nothing processes it until someone writes in the post.
- Agents cannot discover forum ids on their own. To let an agent branch subtasks into posts, put the forum id and spawn policy in `ACPELLA_HOME/.acpella/AGENTS.md`, for example: "To branch a subtask into its own session, run `acpella exec /discord new-session <forum-channel-id> <title> -- <handoff>` with a written handoff (context, stop conditions, mutation boundaries). Spawn deliberately."
