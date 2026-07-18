import "temporal-polyfill/global";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { run } from "@grammyjs/runner";
import { Client, GatewayIntentBits, Partials, type Message } from "discord.js";
import { Bot, type Context, type Filter } from "grammy";
import { loadConfig, type AppConfig } from "./config.ts";
import { createHandler, type Handler } from "./handler.ts";
import { TypingIndicatorManager } from "./lib/channel/typing-indicator.ts";
import { parseCli } from "./lib/cli.ts";
import { CronRunner, type CronDeliveryHandler } from "./lib/cron/runner.ts";
import { CronStore } from "./lib/cron/store.ts";
import { downloadDiscordAttachment } from "./lib/discord/file.ts";
import {
  formatDiscordConversationMetadata,
  formatDiscordSessionName,
  formatDiscordThinking,
} from "./lib/discord/utils.ts";
import { DISCORD_MESSAGE_SPLIT_BUDGET } from "./lib/reply.ts";
import { downloadTelegramFile } from "./lib/telegram/file";
import { markdownToTelegramHtml } from "./lib/telegram/format-html.ts";
import {
  formatTelegramConversationMetadata,
  formatTelegramSessionName,
  getTelegramRetryAfter,
  normalizeUserMention,
} from "./lib/telegram/utils.ts";
import { getVersion } from "./lib/version.ts";
import { addIndent, sleep, truncateString } from "./utils/index.ts";
import { stringifyError } from "./utils/node.ts";

const CLI_HELP = `\
Usage: acpella <command>

Commands:
  serve             Run bot service.
  repl              Run local in-process REPL.
  exec <message...> Run one local message, then exit.

Options:
  --env-file=<path> Use this env file for config resolution.
  -h, --help        Show this help.
`;

async function main() {
  const cliArgv = process.argv.slice(2);
  if (cliArgv.some((arg) => ["-h", "--help"].includes(arg))) {
    console.log(CLI_HELP);
    return;
  }

  const cli = parseCli({
    argv: cliArgv,
    commands: ["serve", "repl", "exec"],
  });

  if (cli.command !== "exec" && cli.args.length > 0) {
    throw new Error(`\
Unexpected arguments for ${cli.command}: ${cli.args.join(" ")}

${CLI_HELP}`);
  }

  if (cli.command === "exec" && cli.args.length === 0) {
    throw new Error(`\
Missing message for exec

${CLI_HELP}`);
  }

  const config = loadConfig({
    envFile: cli.envFile,
  });
  const version = await getVersion({ cwd: path.join(import.meta.dirname, "..") });
  const cronStore = new CronStore({
    cronFile: config.cronFile,
    cronStateFile: config.cronStateFile,
  });

  const cronDeliveryHandlers = new Set<CronDeliveryHandler>();
  function registerCronDeliveryHandler(handler: CronDeliveryHandler): void {
    cronDeliveryHandlers.add(handler);
  }

  const cronRunner = new CronRunner({
    store: cronStore,
    agent: {
      prompt: (...args) => handler.prompt(...args),
    },
    delivery: {
      send: async ({ target, text }) => {
        for (const handler of cronDeliveryHandlers) {
          await handler({ target, text });
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
  handler.start();

  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => handler.stop());
  cleanup.defer(() => cronRunner.stop());

  if (cli.command === "repl") {
    await startRepl({
      config,
      handler,
      version,
      registerCronDeliveryHandler,
    });
    return;
  }

  if (cli.command === "exec") {
    await runExec({ handler, text: cli.args.join(" ") });
    return;
  }

  const channelNames: string[] = [];
  const channelTasks: Promise<void>[] = [];
  if (config.telegram.token) {
    channelNames.push("telegram");
    const botRunner = await serveTelegram({
      config,
      handler,
      registerCronDeliveryHandler,
    });
    cleanup.defer(() => botRunner.stop());
    channelTasks.push(botRunner.task()!);
  }
  if (config.discord.token) {
    channelNames.push("discord");
    const client = await serveDiscord({
      config,
      handler,
      registerCronDeliveryHandler,
    });
    cleanup.defer(() => client.destroy());
    channelTasks.push(new Promise<never>(() => {}));
  }
  if (channelTasks.length === 0) {
    throw new Error("No service channels configured. Configure Telegram or Discord credentials.");
  }
  console.log(
    `Starting service (version: ${version}, home: ${config.home}, channels: ${channelNames.join(", ")})`,
  );
  cronRunner.start();
  await Promise.all(channelTasks);
}

async function serveTelegram(options: {
  config: AppConfig;
  handler: Handler;
  registerCronDeliveryHandler: (handler: CronDeliveryHandler) => void;
}) {
  const { config, handler, registerCronDeliveryHandler } = options;
  const allowedUsers = new Set(config.telegram.allowedUserIds);
  const allowedChats = new Set(config.telegram.allowedChatIds);

  if (!config.telegram.token) {
    throw new Error("ACPELLA_TELEGRAM_BOT_TOKEN is required");
  }
  if (allowedUsers.size === 0) {
    throw new Error("ACPELLA_TELEGRAM_ALLOWED_USER_IDS must be non-empty");
  }

  const telegramToken = config.telegram.token;
  const bot = new Bot(telegramToken);
  const botInfo = await bot.api.getMe();
  const botUsername = botInfo.username;

  registerCronDeliveryHandler(async ({ target, text }) => {
    if (!target.telegram) {
      return;
    }
    const { chatId, messageThreadId } = target.telegram;
    // TODO: fallback, retry, and error handling
    await bot.api.sendMessage(chatId, markdownToTelegramHtml(text), {
      parse_mode: "HTML",
      message_thread_id: messageThreadId,
    });
  });

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

  async function handleTelegramMessage({
    ctx,
    getText,
  }: {
    ctx:
      | Filter<Context, "message:text">
      | Filter<Context, "message:document">
      | Filter<Context, "message:photo">;
    getText: () => Promise<string>;
  }): Promise<void> {
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

    const chatActionManager = new TypingIndicatorManager({
      send: () => ctx.replyWithChatAction("typing"),
      logLabel: label,
      getRetryAfter: getTelegramRetryAfter,
    });
    chatActionManager.start();
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() => chatActionManager.stop());

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
      const text = await getText();
      console.log(
        addIndent({
          indent: `${label} (request) `,
          text: truncateString(text, 200),
        }),
      );

      await handler.handle({
        sessionName,
        text: normalizeUserMention({
          text,
          username: botUsername,
        }),
        metadata: {
          promptMetadata: {
            timestamp: ctx.message.date * 1000,
            channel: formatTelegramConversationMetadata(ctx),
          },
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
      await replyWithRetry(`[acpella error]\n${truncateString(stringifyError(error), 2000)}`);
    }
  }

  bot.on("message:text", async (ctx) => {
    await handleTelegramMessage({
      ctx,
      getText: async () => ctx.message.text,
    });
  });

  bot.on("message:document", async (ctx) => {
    await handleTelegramMessage({
      ctx,
      getText: async () => {
        const uploadedFilePath = await downloadTelegramFile({
          bot,
          fileId: ctx.message.document.file_id,
          fileName: ctx.message.document.file_name,
        });
        return [ctx.message.caption, `[User uploaded file: ${uploadedFilePath}]`]
          .filter(Boolean)
          .join("\n\n");
      },
    });
  });

  bot.on("message:photo", async (ctx) => {
    await handleTelegramMessage({
      ctx,
      getText: async () => {
        const photo = ctx.message.photo.at(-1);
        if (!photo) {
          throw new Error("Telegram photo is missing");
        }
        const uploadedFilePath = await downloadTelegramFile({
          bot,
          fileId: photo.file_id,
          fileName: `${photo.file_unique_id}.jpg`,
        });
        return [ctx.message.caption, `[User uploaded image: ${uploadedFilePath}]`]
          .filter(Boolean)
          .join("\n\n");
      },
    });
  });

  const botRunner = run(bot, {
    sink: {
      // @grammyjs/runner defaults to 500; keep acpella conservative because prompts spawn child agents.
      concurrency: 5,
    },
  });
  return botRunner;
}

async function serveDiscord(options: {
  config: AppConfig;
  handler: Handler;
  registerCronDeliveryHandler: (handler: CronDeliveryHandler) => void;
}) {
  const { config, handler, registerCronDeliveryHandler } = options;

  if (!config.discord.token) {
    throw new Error("ACPELLA_DISCORD_BOT_TOKEN is required");
  }
  if (config.discord.allowedGuildIds.length === 0) {
    throw new Error("ACPELLA_DISCORD_ALLOWED_GUILD_IDS must be non-empty");
  }

  const allowedUsers = new Set(config.discord.allowedUserIds);
  const allowedGuilds = new Set(config.discord.allowedGuildIds);
  const allowedChannels = new Set(config.discord.allowedChannelIds);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  registerCronDeliveryHandler(async ({ target, text }) => {
    if (!target.discord) {
      return;
    }
    const channel = await client.channels.fetch(target.discord.channelId);
    if (!channel?.isSendable()) {
      throw new Error(`Discord channel is not sendable: ${target.discord.channelId}`);
    }
    await channel.send(text);
  });

  async function handleDiscordMessage(message: Message, options?: { selfStarter?: boolean }) {
    const userId = message.author.id;
    const guildId = message.guildId ?? undefined;
    const channelId = message.channelId;
    const sessionName = formatDiscordSessionName(channelId);
    const label = `[${sessionName}:${message.id}]`;

    // an allowlisted parent channel admits its threads
    const parentChannelId =
      (message.channel.isThread() ? message.channel.parentId : undefined) ?? undefined;
    if (
      allowedChannels.size &&
      !allowedChannels.has(channelId) &&
      !(parentChannelId && allowedChannels.has(parentChannelId))
    ) {
      console.error(`${label} rejected: channel ${channelId} is not allowed`);
      return;
    }
    if (!guildId || !allowedGuilds.has(guildId)) {
      console.error(`${label} rejected: guild ${guildId ?? "direct-message"} is not allowed`);
      return;
    }
    if (!options?.selfStarter && allowedUsers.size && !allowedUsers.has(userId)) {
      console.error(`${label} rejected: user ${userId} is not allowed`);
      return;
    }

    const replyChannel = message.channel;
    if (!replyChannel.isSendable()) {
      console.error(`${label} rejected: channel is not sendable`);
      return;
    }

    if (message.system) {
      console.error(`${label} ignored: system message type ${message.type}`);
      return;
    }

    const content = message.content.trim();
    const attachments = [...message.attachments.values()];
    if (!content && attachments.length === 0) {
      console.error(`${label} ignored: message has no text content or attachments`);
      return;
    }

    const typingIndicatorManager = new TypingIndicatorManager({
      send: () => replyChannel.sendTyping(),
      logLabel: label,
    });
    typingIndicatorManager.start();
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() => typingIndicatorManager.stop());

    try {
      let text = content;
      for (const attachment of attachments) {
        const localPath = await downloadDiscordAttachment({
          url: attachment.url,
          fileName: attachment.name,
        });
        const uploadText = attachment.contentType?.startsWith("image/")
          ? `[User uploaded image: ${localPath}]`
          : `[User uploaded file: ${localPath}]`;
        text = [text, uploadText].filter(Boolean).join("\n\n");
      }

      console.log(
        addIndent({
          indent: `${label} (request) `,
          text: truncateString(text, 200),
        }),
      );

      await handler.handle({
        sessionName,
        text,
        // TODO: move transport-specific split/render policy out of HandlerContext.
        replyLimit: DISCORD_MESSAGE_SPLIT_BUDGET,
        formatThinking: formatDiscordThinking,
        metadata: {
          promptMetadata: {
            timestamp: message.createdTimestamp,
            channel: formatDiscordConversationMetadata({
              guildId,
              channelId,
              isDirectMessage: message.channel.isDMBased(),
            }),
            ...(message.channel.isThread() ? { thread_name: message.channel.name } : {}),
          },
          cronDeliveryTarget: {
            discord: {
              channelId,
            },
          },
        },
        send: async (replyText) => {
          return await replyChannel.send(replyText);
        },
      });
      console.log(`${label} (response ok)`);
    } catch (error) {
      console.error(`${label} (response error)`, error);
      await replyChannel.send(`[acpella error]\n${truncateString(stringifyError(error), 1800)}`);
    }
  }

  client.on("messageCreate", async (message) => {
    // A message whose id equals its channel id is the starter of a thread-only
    // channel (e.g. a forum post). Admitting the bot's own starter lets a post
    // created by `/channel new-session` become that session's first prompt,
    // while all other bot-authored messages stay ignored.
    const selfStarter = message.author.id === client.user?.id && message.id === message.channelId;
    if (message.author.bot && !selfStarter) {
      return;
    }
    await handleDiscordMessage(message, { selfStarter });
  });

  client.on("error", (error) => {
    console.error("[discord] client error", error);
  });

  await client.login(config.discord.token);
  return client;
}

async function startRepl({
  config,
  handler,
  registerCronDeliveryHandler,
  version,
}: {
  config: AppConfig;
  handler: Handler;
  registerCronDeliveryHandler: (handler: CronDeliveryHandler) => void;
  version: string;
}) {
  console.log(`Starting repl (version: ${version}, home: ${config.home})`);
  registerCronDeliveryHandler(async ({ target, text }) => {
    if (!target.repl) {
      return;
    }
    console.log("[cron] repl delivery:", text);
    console.log(text);
  });

  let isHandling = false;
  async function sendMessage(text: string) {
    isHandling = true;
    try {
      await runExec({ handler, text });
    } catch (error) {
      console.error(error);
    } finally {
      isHandling = false;
    }
  }

  using rl = createInterface({ input: process.stdin, output: process.stdout });

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
  }
}

// TODO:
// make exitCode non-zero for soft errors (e.g. invalid command usages) on exec.
// currently only hard errors can make exitCode = 1.
// (plan: enhance context.send interface to include status semantics)
async function runExec({ handler, text }: { handler: Handler; text: string }) {
  await handler.handle({
    sessionName: "repl",
    text,
    metadata: {
      promptMetadata: {
        timestamp: Date.now(),
      },
      cronDeliveryTarget: {
        repl: true,
      },
    },
    send: async (replyText) => {
      console.log(replyText);
    },
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
