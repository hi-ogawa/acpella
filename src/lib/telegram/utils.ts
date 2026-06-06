import { GrammyError, type Context } from "grammy";

export function normalizeUserMention({
  text,
  username,
}: {
  text: string;
  username: string;
}): string {
  const match = text.match(/^(\/\w+)@(\w+)(?=\s|$)/);
  if (match) {
    const [prefix, command, target] = match;
    if (target.toLowerCase() === username.toLowerCase()) {
      const rest = text.slice(prefix.length);
      return `${command}${rest}`;
    }
  }
  return text;
}

export function formatTelegramSessionName(context: Context): string {
  return ["tg", context.chat?.id ?? "unknown", context.message?.message_thread_id]
    .filter(Boolean)
    .join("-");
}

// TODO: standardize one-to-one mapping between sessionName and CronDeliveryTarget
export function parseTelegramSessionName(sessionName: string) {
  const match = /^tg-(-?\d+)(?:-(\d+))?$/.exec(sessionName);
  if (!match) {
    return;
  }
  const chatId = parseInt(match[1]!, 10);
  const messageThreadId = match[2] ? parseInt(match[2], 10) : undefined;
  return { chatId, messageThreadId };
}

export function formatTelegramConversationMetadata(context: Context): string {
  const chat = context.chat;
  if (!chat) {
    return "telegram:unknown";
  }
  if (chat.type === "private") {
    return "telegram:direct";
  }
  const messageThreadId = context.message?.message_thread_id;
  if (messageThreadId !== undefined) {
    return `telegram:group:${chat.title}:topic:${messageThreadId}`;
  }
  return `telegram:group:${chat.title}`;
}

export function getTelegramRetryAfter(error: unknown): number | undefined {
  if (error instanceof GrammyError && error.error_code === 429) {
    return error.parameters.retry_after;
  }
}
