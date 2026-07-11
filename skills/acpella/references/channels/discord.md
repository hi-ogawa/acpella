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

## Sending Files

`/session send-file <path> [--target <sessionName>]` posts a local file as a Discord attachment to a session's channel. Through `acpella exec` it sends via the Discord REST API using `ACPELLA_DISCORD_BOT_TOKEN`, so it works without the running service.

Discord rejects attachments over its upload size limit (10MB by default, higher on boosted servers); the command surfaces the API error instead of pre-checking.
