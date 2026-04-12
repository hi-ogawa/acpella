import { Bot } from "grammy";
import { loadConfig } from "./config.ts";
import { createHandler } from "./handler.ts";
import { createTestBot, startTestBotRepl, type TestBot } from "./repl.ts";

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const config = loadConfig();
  const { handle } = await createHandler(config);

  // --- create bot (real or test) ---

  let bot: Bot;
  let testBot: TestBot | undefined;
  let allowedUsers: Set<number> | undefined;
  let allowedChats: Set<number> | undefined;

  if (cli.repl) {
    testBot = createTestBot({ chatId: config.testChatId });
    bot = testBot.bot;
  } else {
    allowedUsers = new Set(config.telegram.allowedUserIds);
    allowedChats = new Set(config.telegram.allowedChatIds);

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
    const chatId = ctx.chat.id;
    const threadId = ctx.message.message_thread_id;

    if (!cli.repl) {
      const userId = ctx.from?.id;

      if (allowedChats?.size && !allowedChats.has(chatId)) {
        console.error(`[${sessionName(chatId, threadId)}] rejected: chat ${chatId} is not allowed`);
        return;
      }
      if (!userId || (allowedUsers?.size && !allowedUsers.has(userId))) {
        console.error(
          `[${sessionName(chatId, threadId)}] rejected: user ${userId ?? "unknown"} is not allowed`,
        );
        return;
      }
    }

    const name = sessionName(chatId, threadId);
    const text = ctx.message.text;

    if (!cli.repl) {
      console.log(`[${name}] <- ${text}`);
    }

    try {
      const response = await handle(text, name);
      if (!cli.repl) {
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
    `Starting service (agent: ${config.agent.alias}, home: ${config.home}, repl: ${cli.repl})`,
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

function parseCliArgs(args: string[]): { repl: boolean } {
  const unknown = args.filter((arg) => arg !== "--repl");
  if (unknown.length > 0) {
    throw new Error(`Unknown argument: ${unknown.join(", ")}`);
  }
  return { repl: args.includes("--repl") };
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
