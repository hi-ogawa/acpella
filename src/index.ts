import { Bot } from "grammy";
import { loadConfig } from "./config.ts";
import { createHandler } from "./handler.ts";
import { runSystemdUnitCommand } from "./lib/systemd.ts";
import { createTestBot, startTestBotRepl, type TestBot } from "./repl.ts";

async function main() {
  const handled = handleCli({ argv: process.argv.slice(2) });
  if (handled) {
    return;
  }

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

function handleCli(options: { argv: string[] }): boolean {
  const [command, ...args] = options.argv;
  if (!command) {
    return false;
  }
  if (command === "--help" || command === "-h") {
    process.stdout.write(renderHelp());
    return true;
  }
  if (command !== "generate-systemd-unit") {
    throw new Error(`Unknown command: ${command}`);
  }

  runSystemdUnitCommand({ argv: args });
  return true;
}

function renderHelp(): string {
  return `Usage:
  node src/index.ts
  node src/index.ts generate-systemd-unit [options]
`;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
