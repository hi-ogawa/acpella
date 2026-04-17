import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { run, sequentialize } from "@grammyjs/runner";
import { Bot } from "grammy";
import { loadConfig, type AppConfig } from "./config.ts";
import { createHandler, type Handler } from "./handler.ts";
import { handleSetupSystemd } from "./lib/systemd.ts";
import { markdownToTelegramHtml } from "./lib/telegram-format-html.ts";
import { telegramSequentialKey, telegramSessionName } from "./lib/telegram.ts";
import { getVersion } from "./lib/version.ts";

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

  const handler = await createHandler(config, {
    version,
    onServiceExit: () => {
      setImmediate(() => {
        console.log("Exiting by /service exit");
        process.exit(0);
      });
    },
  });

  if (cli.repl) {
    await startRepl(config, handler, version);
    return;
  }

  const allowedUsers = new Set(config.telegram.allowedUserIds);
  const allowedChats = new Set(config.telegram.allowedChatIds);

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

  const bot = new Bot(config.telegram.token);
  try {
    const commands = Object.entries(handler.commands).map(([command, description]) => ({
      command,
      description,
    }));
    await bot.api.setMyCommands(commands);
  } catch (error) {
    console.warn("[telegram] failed to register bot commands:", error);
  }
  bot.use(sequentialize(telegramSequentialKey));

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const threadId = ctx.message.message_thread_id;
    const sessionName = telegramSessionName({ chatId, threadId });
    const userId = ctx.from?.id;

    if (allowedChats.size && !allowedChats.has(chatId)) {
      console.error(`[${sessionName}] rejected: chat ${chatId} is not allowed`);
      return;
    }
    if (!userId || (allowedUsers.size && !allowedUsers.has(userId))) {
      console.error(`[${sessionName}] rejected: user ${userId ?? "unknown"} is not allowed`);
      return;
    }

    const text = ctx.message.text;

    console.log(`[${sessionName}] <- ${text}`);

    try {
      await handler.handle({
        sessionName,
        context: {
          message: ctx.message,
          metadata: {
            timestamp: Date.now(),
          },
          reply: async (replyText) => {
            const html = markdownToTelegramHtml(replyText);
            try {
              return await ctx.reply(html, {
                parse_mode: "HTML",
              });
            } catch (error) {
              console.warn(
                `[${sessionName}] formatted reply failed; falling back to raw text:`,
                error,
              );
              return await ctx.reply(replyText);
            }
          },
        },
      });
      console.log(`[${sessionName}] -> response sent`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[${sessionName}] error: ${msg}`);
      await ctx.reply(`Error: ${msg.slice(0, 200)}`);
    }
  });

  console.log(`Starting service (version: ${version}, home: ${config.home})`);

  const runner = run(bot, {
    sink: {
      // @grammyjs/runner defaults to 500; keep acpella conservative because prompts spawn child agents.
      concurrency: 4,
    },
  });
  await runner.task();
}

async function startRepl(config: AppConfig, handler: Handler, version: string) {
  console.log(`Starting repl (version: ${version}, home: ${config.home})`);

  let isHandling = false;
  async function sendMessage(text: string) {
    isHandling = true;
    try {
      await handler.handle({
        sessionName: "repl",
        context: {
          message: { text },
          metadata: {
            timestamp: Date.now(),
          },
          async reply(text) {
            console.log(text);
          },
        },
      });
    } catch (error) {
      console.error(error);
    } finally {
      isHandling = false;
    }
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let cancelRequested = false;
  rl.on("SIGINT", () => {
    if (!isHandling || cancelRequested) {
      rl.close();
      return;
    }
    cancelRequested = true;
    void sendMessage("/cancel").finally(() => {
      cancelRequested = false;
    });
  });

  try {
    while (true) {
      const text = await rl.question("> ");
      if (!text) {
        continue;
      }
      if (text === "/quit") {
        break;
      }
      await sendMessage(text);
    }
  } catch (e) {
    if (!(e instanceof Error && e.name === "AbortError")) {
      throw e;
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
