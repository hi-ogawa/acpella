import "temporal-polyfill/global";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { run, sequentialize } from "@grammyjs/runner";
import { Bot } from "grammy";
import { loadConfig, type AppConfig } from "./config.ts";
import { CronRunner } from "./cron/runner.ts";
import { CronStore } from "./cron/store.ts";
import { createHandler, type Handler } from "./handler.ts";
import { handleSetupSystemd } from "./lib/systemd.ts";
import { markdownToTelegramHtml } from "./lib/telegram/format-html.ts";
import {
  formatTelegramSessionName,
  getTelegramRetryAfter,
  normalizeUserMention,
  TelegramChatActionManager,
} from "./lib/telegram/utils.ts";
import { addIndent, sleep, truncateString } from "./lib/utils.ts";
import { getVersion } from "./lib/version.ts";

type CliCommand =
  | { type: "help" }
  | { type: "repl" }
  | { type: "serve" }
  | { type: "systemd-install" };

const USAGE = `Usage: node src/cli.ts [command]

Commands:
  serve             Run Telegram bot service. Default when no command is provided.
  repl              Run local in-process REPL.
  systemd install   Setup systemd service.
  help              Show this help.

Options:
  -h, --help        Show this help.
`;

function parseCliCommand(argv: string[]): { command: CliCommand } | { error: string } {
  const [command, ...args] = argv;

  if (!command) {
    return { command: { type: "serve" } };
  }
  if (command === "-h" || command === "--help" || command === "help") {
    if (args.length > 0) {
      return { error: `Unexpected arguments for ${command}: ${args.join(" ")}` };
    }
    return { command: { type: "help" } };
  }
  if (command === "serve") {
    if (args.length > 0) {
      return { error: `Unexpected arguments for serve: ${args.join(" ")}` };
    }
    return { command: { type: "serve" } };
  }
  if (command === "repl") {
    if (args.length > 0) {
      return { error: `Unexpected arguments for repl: ${args.join(" ")}` };
    }
    return { command: { type: "repl" } };
  }
  if (command === "systemd") {
    if (args.length === 1 && args[0] === "install") {
      return { command: { type: "systemd-install" } };
    }
    return { error: "Usage: node src/cli.ts systemd install" };
  }

  return { error: `Unknown command: ${command}` };
}

async function main() {
  const parsed = parseCliCommand(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const { command } = parsed;

  if (command.type === "systemd-install") {
    handleSetupSystemd();
    return;
  }

  if (command.type === "help") {
    process.stdout.write(USAGE);
    return;
  }

  const config = loadConfig();
  const version = await getVersion({ cwd: path.join(import.meta.dirname, "..") });
  const cronStore = new CronStore({
    cronFile: config.cronFile,
    cronStateFile: config.cronStateFile,
  });
  const cronRunner = new CronRunner({
    store: cronStore,
    agent: {
      prompt: (...args) => handler.prompt(...args),
    },
    delivery: {
      send: async ({ target, text }) => {
        if (target.repl) {
          console.log("[cron] repl delivery:", text);
          console.log(text);
        }
        if (command.type === "serve" && target.telegram) {
          const { chatId, messageThreadId } = target.telegram;
          // TODO: fallback, retry, and error handling
          await bot.api.sendMessage(chatId, markdownToTelegramHtml(text), {
            parse_mode: "HTML",
            message_thread_id: messageThreadId,
          });
        }
      },
    },
  });

  const handler = await createHandler(config, {
    version,
    onServiceExit: () => {
      setImmediate(() => {
        console.log("Exiting by /service exit");
        process.exit(0);
      });
    },
    cronStore,
    // TODO: break handler <-> cronRunner cycle
    // docs/tasks/2026-04-19-agent-session-service-architecture.md
    getCronRunner: () => cronRunner,
  });

  if (command.type === "repl") {
    try {
      await startRepl(config, handler, version);
    } finally {
      cronRunner.stop();
    }
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
  const botInfo = await bot.api.getMe();
  const botUsername = botInfo.username;

  try {
    const commands = Object.entries(handler.commands).map(([command, description]) => ({
      command,
      description,
    }));
    await bot.api.setMyCommands(commands);
  } catch (error) {
    console.error("[telegram] failed to register bot commands:", error);
  }

  bot.catch((error) => {
    const ctx = error.ctx;
    const sessionName = formatTelegramSessionName(ctx);
    const label = `[${sessionName}:${ctx.message?.message_id ?? "unknown"}]`;
    console.error(`${label} (bot error)`, error.error);
  });

  // handle messages from each session and system commands concurrently
  bot.use(
    sequentialize((ctx) => {
      let key = formatTelegramSessionName(ctx);
      const text = normalizeUserMention({
        text: ctx.message?.text?.trim() ?? "",
        username: botUsername,
      });
      if (text === "/status" || text === "/cancel") {
        key += text;
      }
      return key;
    }),
  );

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;
    const sessionName = formatTelegramSessionName(ctx);
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

    const chatActionManager = new TelegramChatActionManager({
      send: () => ctx.replyWithChatAction("typing"),
      logLabel: label,
    });
    chatActionManager.start();

    const replyWithRetry = async (...args: Parameters<typeof ctx.reply>) => {
      try {
        return await ctx.reply(...args);
      } catch (error) {
        // rethrow non rate limit errors
        const retryAfter = getTelegramRetryAfter(error);
        if (!retryAfter) {
          throw error;
        }
        console.error(`${label} reply failed. retrying...`, {
          args,
          error,
          retryAfter,
        });
        await sleep((retryAfter + 1) * 1000);
        return await ctx.reply(...args);
      }
    };

    try {
      await handler.handle({
        sessionName,
        text: normalizeUserMention({
          text: ctx.message.text,
          username: botUsername,
        }),
        metadata: {
          timestamp: ctx.message.date * 1000,
          cronDeliveryTarget: {
            telegram: {
              chatId,
              messageThreadId: ctx.message.message_thread_id,
            },
          },
        },
        send: async (replyText) => {
          const html = markdownToTelegramHtml(replyText);
          try {
            return await replyWithRetry(html, {
              parse_mode: "HTML",
            });
          } catch (error) {
            // rethrow rate limit errors
            if (getTelegramRetryAfter(error)) {
              throw error;
            }
            console.error(`${label} formatted reply failed; falling back to raw text:`, error);
            return await replyWithRetry(replyText);
          }
        },
      });
      console.log(`${label} (response ok)`);
    } catch (error) {
      if (getTelegramRetryAfter(error)) {
        console.error(`${label} reply failed due to rate limit.`, error);
        return;
      }
      console.error(`${label} (response error)`, error);
      const message = error instanceof Error ? error.message : String(error);
      await replyWithRetry(`Error: ${truncateString(message, 200)}`);
    } finally {
      chatActionManager.stop();
    }
  });

  console.log(`Starting service (version: ${version}, home: ${config.home})`);

  cronRunner.start();
  const runner = run(bot, {
    sink: {
      // @grammyjs/runner defaults to 500; keep acpella conservative because prompts spawn child agents.
      concurrency: 5,
    },
  });
  try {
    await runner.task();
  } finally {
    cronRunner.stop();
  }
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
          cronDeliveryTarget: {
            repl: true,
          },
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
