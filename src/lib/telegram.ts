import type { Context } from "grammy";

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

type TelegramSequentialKeyContext = DeepPartial<Pick<Context, "chat" | "message">>;

export function telegramSessionName(options: { chatId: number; threadId?: number }): string {
  const base = `tg-${options.chatId}`;
  return options.threadId ? `${base}-${options.threadId}` : base;
}

export function telegramSequentialKey(context: TelegramSequentialKeyContext): string {
  const chatId = context.chat?.id;
  if (typeof chatId !== "number") {
    return "tg-unknown";
  }

  const base = telegramSessionName({
    chatId,
    threadId: context.message?.message_thread_id,
  });
  return context.message?.text === "/cancel" ? `${base}:control` : base;
}
