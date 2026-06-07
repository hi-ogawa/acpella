# Telegram Channel

Use this reference for a lightweight Telegram setup for `acpella serve`.

## Telegram Bot

1. Message `@BotFather` on Telegram.
2. Create a bot with `/newbot`.
3. Copy the bot token for `ACPELLA_TELEGRAM_BOT_TOKEN`.
4. Start a private chat with the bot, or add it to a group where acpella should run.

## IDs

Telegram access is controlled with numeric allowlists:

- User ID: your Telegram user id. This is required for Telegram serve.
- Chat ID: optional private chat, group, or supergroup id for a chat allowlist.
- Topic/thread ID: acpella derives this automatically from Telegram messages when used in forum topics.

If you do not already know your IDs, send a message to the bot while running acpella and check the service logs for rejected user/chat IDs.

## Environment

For a private bot setup, require the user allowlist and keep the chat allowlist optional:

```env
ACPELLA_TELEGRAM_BOT_TOKEN=...
ACPELLA_TELEGRAM_ALLOWED_USER_IDS=123456789

# Optional extra chat/group filter
ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS=123456789
```

`ACPELLA_TELEGRAM_ALLOWED_USER_IDS` is the main safety boundary. Use `ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS` when the bot is in groups or should only respond in selected chats.

## Run

Telegram is enabled for `acpella serve` when `ACPELLA_TELEGRAM_BOT_TOKEN` is set.

```bash
acpella serve
```
