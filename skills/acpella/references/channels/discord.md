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

```bash
acpella serve --channel=discord
```

When dogfooding Telegram and Discord as separate service processes, let only one process run cron:

```bash
acpella serve --channel=telegram
acpella serve --channel=discord --no-cron
```
