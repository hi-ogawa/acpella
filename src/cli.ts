import path from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { run, sequentialize } from "@grammyjs/runner";
import { Bot, GrammyError, type Context } from "grammy";
import { loadConfig, type AppConfig } from "./config.ts";
import { createHandler, type Handler } from "./handler.ts";
import { handleSetupSystemd } from "./lib/systemd.ts";
import { markdownToTelegramHtml } from "./lib/telegram-format-html.ts";
import { addIndent, truncateString } from "./lib/utils.ts";
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
    console.error("[telegram] failed to register bot commands:", summarizeError(error));
  }

  bot.catch((error) => {
    const ctx = error.ctx;
    const sessionName = telegramSessionName(ctx);
    const label = `[${sessionName}:${ctx.message?.message_id ?? "unknown"}]`;
    console.error(`${label} (bot error)`, {
      updateId: ctx.update.update_id,
      chatId: ctx.chat?.id,
      threadId: ctx.message?.message_thread_id,
      error: summarizeError(error.error),
    });
  });

  // handle messages from each session and system commands concurrently
  bot.use(
    sequentialize((ctx) => {
      let key = telegramSessionName(ctx);
      const text = ctx.message?.text?.trim() ?? "";
      if (text === "/status" || text === "/cancel") {
        key += text;
      }
      return key;
    }),
  );

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;
    const sessionName = telegramSessionName(ctx);
    const label = `[${sessionName}:${ctx.message.message_id}]`;

    if (allowedChats.size && !allowedChats.has(chatId)) {
      console.error(`${label} rejected: chat ${chatId} is not allowed`);
      return;
    }
    if (!userId || (allowedUsers.size && !allowedUsers.has(userId))) {
      console.error(`${label} rejected: user ${userId ?? "unknown"} is not allowed`);
      return;
    }

    const text = ctx.message.text;
    console.log(
      addIndent({
        indent: `${label} (request) `,
        text: truncateString(text, 200),
      }),
    );

    try {
      await handler.handle({
        sessionName,
        text: ctx.message.text,
        metadata: {
          timestamp: ctx.message.date * 1000,
        },
        send: async (replyText) => {
          const html = markdownToTelegramHtml(replyText);
          try {
            return await ctx.reply(html, {
              parse_mode: "HTML",
            });
          } catch (error) {
            if (getTelegramRetryAfter(error) !== undefined) {
              throw error;
            }
            console.error(
              `${label} formatted reply failed; falling back to raw text:`,
              summarizeError(error),
            );
            return await ctx.reply(replyText);
          }
        },
      });
      console.log(`${label} (response ok)`);
    } catch (error) {
      console.error(`${label} (response error)`, summarizeError(error));
      const message = error instanceof Error ? error.message : String(error);
      try {
        await retryTelegram429Once({
          label,
          action: () => ctx.reply(`Error: ${truncateString(message, 200)}`),
        });
      } catch (replyError) {
        console.error(`${label} error reply failed; giving up:`, summarizeError(replyError));
      }
    }
  });

  console.log(`Starting service (version: ${version}, home: ${config.home})`);

  const runner = run(bot, {
    sink: {
      // @grammyjs/runner defaults to 500; keep acpella conservative because prompts spawn child agents.
      concurrency: 5,
    },
  });
  await runner.task();
}

function telegramSessionName(context: Context): string {
  return ["tg", context.chat?.id ?? "unknown", context.message?.message_thread_id]
    .filter(Boolean)
    .join("-");
}

function getTelegramRetryAfter(error: unknown): number | undefined {
  if (!(error instanceof GrammyError) || error.error_code !== 429) {
    return;
  }
  return error.parameters.retry_after;
}

async function retryTelegram429Once<T>(options: {
  label: string;
  action: () => Promise<T>;
}): Promise<T> {
  try {
    return await options.action();
  } catch (error) {
    const retryAfter = getTelegramRetryAfter(error);
    if (retryAfter === undefined) {
      throw error;
    }

    const delaySeconds = retryAfter + 1;
    console.warn(
      `${options.label} telegram flood control; retrying in ${delaySeconds}s:`,
      summarizeError(error),
    );
    await sleep(delaySeconds * 1000);
    return await options.action();
  }
}

function summarizeError(error: unknown): unknown {
  if (error instanceof GrammyError) {
    return {
      name: error.name,
      message: error.message,
      method: error.method,
      errorCode: error.error_code,
      description: error.description,
      retryAfter: error.parameters.retry_after,
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return String(error);
}

async function startRepl(config: AppConfig, handler: Handler, version: string) {
  console.log(`Starting repl (version: ${version}, home: ${config.home})`);

  let isHandling = false;
  async function sendMessage(text: string) {
    isHandling = true;
    try {
      await handler.handle({
        sessionName: "repl",
        text,
        metadata: {
          timestamp: Date.now(),
        },
        send: async (replyText) => console.log(replyText),
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
