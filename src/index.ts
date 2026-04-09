import { Bot } from "grammy";
import { createHandler } from "./handler.ts";
import { createTestBot, startTestBotRepl } from "./test-bot.ts";

function main() {
  const { handle, config: handlerConfig } = createHandler();
  const { agent, cwd } = handlerConfig;

  // TODO: require ALLOWED_USER_IDS
  const allowedUsers = new Set(
    (process.env.ALLOWED_USER_IDS ?? "").split(",").filter(Boolean).map(Number),
  );
  const allowedChats = new Set(
    (process.env.ALLOWED_CHAT_IDS ?? "").split(",").filter(Boolean).map(Number),
  );

  // --- create bot (real or test) ---

  const testMode = !!process.env.ACPELLA_TEST_BOT;
  let bot: Bot;
  // TODO: import type { TestBot }
  let testBot: ReturnType<typeof createTestBot> | undefined;

  if (testMode) {
    testBot = createTestBot();
    bot = testBot.bot;
  } else {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error("TELEGRAM_BOT_TOKEN is required");
      process.exitCode = 1;
      return;
    }
    bot = new Bot(token, {
      client: { apiRoot: process.env.TELEGRAM_API_ROOT },
    });
  }

  // --- wire handler (shared between real and test) ---

  bot.on("message:text", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat.id;
    const threadId = ctx.message.message_thread_id;

    if (allowedChats.size > 0 && !allowedChats.has(chatId)) return;
    if (!userId || (allowedUsers.size > 0 && !allowedUsers.has(userId))) return;

    const name = sessionName(chatId, threadId);
    const text = ctx.message.text;

    console.log(`[${name}] <- ${text}`);

    try {
      const response = await handle(text, name);
      console.log(`[${name}] -> ${response.slice(0, 100)}...`);
      await ctx.reply(response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${name}] error: ${msg}`);
      await ctx.reply(`Error: ${msg.slice(0, 200)}`);
    }
  });

  // --- start ---

  console.log(`Starting daemon (agent: ${agent}, cwd: ${cwd}, test: ${testMode})`);

  if (testBot) {
    startTestBotRepl(testBot);
  } else {
    bot.start();
  }
}

function sessionName(chatId: number, threadId?: number): string {
  const base = `tg-${chatId}`;
  return threadId ? `${base}-${threadId}` : base;
}

main();
