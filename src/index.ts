import { Bot } from "grammy";
import { createHandler } from "./handler.ts";
import { createTestBot, startTestBotRepl, type TestBot } from "./test-bot.ts";

async function main() {
  const { handle, config: handlerConfig } = createHandler();
  const { agent, cwd } = handlerConfig;

  const allowedUsers = new Set(
    (process.env.ACPELLA_TELEGRAM_ALLOWED_USER_IDS ?? "").split(",").filter(Boolean).map(Number),
  );
  const allowedChats = new Set(
    (process.env.ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS ?? "").split(",").filter(Boolean).map(Number),
  );

  // --- create bot (real or test) ---

  const testMode = !!process.env.ACPELLA_TEST_BOT;
  let bot: Bot;
  let testBot: TestBot | undefined;

  if (testMode) {
    testBot = createTestBot();
    bot = testBot.bot;
  } else {
    const token = process.env.ACPELLA_TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error("ACPELLA_TELEGRAM_BOT_TOKEN is required");
      process.exitCode = 1;
      return;
    }
    if (allowedUsers.size === 0) {
      console.error("ACPELLA_TELEGRAM_ALLOWED_USER_IDS must be non-empty");
      process.exitCode = 1;
      return;
    }
    bot = new Bot(token);
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

  console.log(`Starting service (agent: ${agent}, cwd: ${cwd}, test: ${testMode})`);

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
