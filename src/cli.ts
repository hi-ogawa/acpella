import path from "node:path";
import { parseArgs } from "node:util";
import { run, sequentialize } from "@grammyjs/runner";
import { Bot, GrammyError, HttpError } from "grammy";
import { loadConfig } from "./config.ts";
import { createHandler } from "./handler.ts";
import { handleSetupSystemd } from "./lib/systemd.ts";
import { telegramSequentialKey, telegramSessionName } from "./lib/telegram.ts";
import { getVersion } from "./lib/version.ts";
import { createTestBot, type TestBot } from "./repl.ts";

async function replyWithRetry(
  ctx: { reply: (text: string) => Promise<unknown> },
  text: string,
  sessionName: string,
): Promise<void> {
  try {
    await ctx.reply(text);
  } catch (replyErr) {
    if (replyErr instanceof GrammyError && replyErr.error_code === 429) {
      const retryAfterSec = replyErr.parameters?.retry_after;
      const retryAfterMs =
        ((retryAfterSec != null && retryAfterSec > 0 ? retryAfterSec : 0) + 1) * 1000;
      console.error(`[${sessionName}] error reply hit 429, retrying after ${retryAfterMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      try {
        await ctx.reply(text);
      } catch (finalErr) {
        const finalMsg = finalErr instanceof Error ? finalErr.message : String(finalErr);
        console.error(`[${sessionName}] error reply failed (gave up): ${finalMsg}`);
      }
    } else {
      const replyMsg = replyErr instanceof Error ? replyErr.message : String(replyErr);
      console.error(`[${sessionName}] error reply failed: ${replyMsg}`);
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const { values: cli } = parseArgs({
    args: argv,
    options: {
      repl: {
        type: "boolean",
        default: false,
      },
      help: {
        type: "boolean",
        short: "h",
        default: false,
      },
      "setup-systemd": {
        type: "boolean",
        default: false,
      },
    },
    strict: true,
  });

  if (cli["setup-systemd"]) {
    handleSetupSystemd();
    return;
  }

  if (cli.help) {
    process.stdout.write(`Usage: node src/cli.ts [options]

Options:
  --repl                 Run local in-process REPL.
  --setup-systemd        Setup systemd service.
  -h, --help             Show this help.
`);
    return;
  }

  const config = loadConfig();
  const version = await getVersion({ cwd: path.join(import.meta.dirname, "..") });

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

  const handler = await createHandler(config, {
    version,
    onServiceExit: () => {
      setImmediate(() => {
        console.log("Exiting by /service exit");
        process.exit(0);
      });
    },
  });
  if (!cli.repl) {
    bot.use(sequentialize(telegramSequentialKey));
  }

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const threadId = ctx.message.message_thread_id;
    const sessionName = telegramSessionName({ chatId, threadId });

    if (!cli.repl) {
      const userId = ctx.from?.id;

      if (allowedChats?.size && !allowedChats.has(chatId)) {
        console.error(`[${sessionName}] rejected: chat ${chatId} is not allowed`);
        return;
      }
      if (!userId || (allowedUsers?.size && !allowedUsers.has(userId))) {
        console.error(`[${sessionName}] rejected: user ${userId ?? "unknown"} is not allowed`);
        return;
      }
    }

    const text = ctx.message.text;

    if (!cli.repl) {
      console.log(`[${sessionName}] <- ${text}`);
    }

    try {
      await handler.handle({ sessionName, context: ctx });
      if (!cli.repl) {
        console.log(`[${sessionName}] -> response sent`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${sessionName}] error: ${msg}`);
      await replyWithRetry(ctx, `Error: ${msg.slice(0, 200)}`, sessionName);
    }
  });

  // --- start ---

  console.log(
    `Starting service (agent: ${config.agent.alias}, home: ${config.home}, repl: ${cli.repl})`,
  );

  if (!cli.repl) {
    bot.catch((err) => {
      const { error } = err;
      if (error instanceof GrammyError) {
        console.error(`[bot] Telegram API error: ${error.error_code} ${error.description}`);
      } else if (error instanceof HttpError) {
        console.error(`[bot] HTTP error: ${error.message}`);
      } else {
        console.error(
          `[bot] unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  if (testBot) {
    await testBot.startRepl();
  } else {
    const runner = run(bot, {
      sink: {
        // @grammyjs/runner defaults to 500; keep acpella conservative because prompts spawn child agents.
        concurrency: 4,
      },
    });
    await runner.task();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
