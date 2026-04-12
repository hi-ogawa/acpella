import { Bot } from "grammy";
import { loadConfig } from "./config.ts";
import { createHandler } from "./handler.ts";
import { createTestBot, startTestBotRepl, type TestBot } from "./test-bot.ts";

async function main() {
  const config = loadConfig();
  const { handle } = await createHandler(config);
  const allowedUsers = new Set(config.telegram.allowedUserIds);
  const allowedChats = new Set(config.telegram.allowedChatIds);

  // --- create bot (real or test) ---

  let bot: Bot;
  let testBot: TestBot | undefined;

  if (config.testMode) {
    testBot = createTestBot({ chatId: config.testChatId });
    bot = testBot.bot;
  } else {
    if (!config.telegram.token) {
      console.error("ACPELLA_TELEGRAM_BOT_TOKEN is required");
      process.exitCode = 1;
      return;
    }
    if (allowedUsers.size === 0) {
      console.error("ACPELLA_TELEGRAM_ALLOWED_USER_IDS must be non-empty");
      process.exitCode = 1;
      return;
    }
    bot = new Bot(config.telegram.token);
  }

  // --- wire handler (shared between real and test) ---

  bot.on("message:text", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat.id;
    const threadId = ctx.message.message_thread_id;

    if (allowedChats.size > 0 && !allowedChats.has(chatId)) {
      return;
    }
    if (!userId || (allowedUsers.size > 0 && !allowedUsers.has(userId))) {
      return;
    }

    const name = sessionName(chatId, threadId);
    const text = ctx.message.text;

    if (!config.testMode) {
      console.log(`[${name}] <- ${text}`);
    }

    try {
      const response = await handle(text, name);
      if (!config.testMode) {
        console.log(`[${name}] -> ${response.slice(0, 100)}...`);
      }
      await ctx.reply(response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${name}] error: ${msg}`);
      await ctx.reply(`Error: ${msg.slice(0, 200)}`);
    }
  });

  // --- start ---

  console.log(
    `Starting service (agent: ${config.agent.alias}, home: ${config.home}, test: ${config.testMode})`,
  );

  if (testBot) {
    await startTestBotRepl(testBot);
  } else {
    await bot.start();
  }
}

function sessionName(chatId: number, threadId?: number): string {
  const base = `tg-${chatId}`;
  return threadId ? `${base}-${threadId}` : base;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
