import { Bot } from "grammy";
import { BOT_TOKEN, ALLOWED_USERS, ALLOWED_CHATS } from "./config.ts";
import { prompt } from "./acpx.ts";

export function sessionName(chatId: number, threadId?: number): string {
  const base = `tg-${chatId}`;
  return threadId ? `${base}-${threadId}` : base;
}

export function createBot(): Bot {
  const bot = new Bot(BOT_TOKEN);

  bot.on("message:text", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat.id;
    const threadId = ctx.message.message_thread_id;

    if (ALLOWED_CHATS.size > 0 && !ALLOWED_CHATS.has(chatId)) return;
    if (!userId || (ALLOWED_USERS.size > 0 && !ALLOWED_USERS.has(userId))) return;

    const name = sessionName(chatId, threadId);
    const text = ctx.message.text;

    console.log(`[${name}] <- ${text}`);

    try {
      const response = await prompt(name, text);
      console.log(`[${name}] -> ${response.slice(0, 100)}...`);
      await ctx.reply(response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${name}] error: ${msg}`);
      await ctx.reply(`Error: ${msg.slice(0, 200)}`);
    }
  });

  return bot;
}
