import { run } from "@grammyjs/runner";
import { Bot, type Context, type Filter } from "grammy";
import type { AppConfig } from "../config.ts";
import type { Handler } from "../handler.ts";
import type { CronDeliveryTarget } from "../lib/cron/store.ts";
import { downloadTelegramFile } from "../lib/telegram/file";
import { markdownToTelegramHtml } from "../lib/telegram/format-html.ts";
import {
  formatTelegramConversationMetadata,
  formatTelegramSessionName,
  getTelegramRetryAfter,
  normalizeUserMention,
  TelegramChatActionManager,
} from "../lib/telegram/utils.ts";
import { addIndent, sleep, truncateString } from "../utils/index.ts";
import { stringifyError } from "../utils/node.ts";

export async function serveTelegram(options: {
  config: AppConfig;
  handler: Handler;
  version: string;
  setCronDeliveryHandler: (
    handler: (target: CronDeliveryTarget, text: string) => Promise<void>,
  ) => void;
}) {
  const { config, handler, version, setCronDeliveryHandler } = options;
  const allowedUsers = new Set(config.telegram.allowedUserIds);
  const allowedChats = new Set(config.telegram.allowedChatIds);

  if (!config.telegram.token) {
    throw new Error("ACPELLA_TELEGRAM_BOT_TOKEN is required");
  }
  if (allowedUsers.size === 0) {
    throw new Error("ACPELLA_TELEGRAM_ALLOWED_USER_IDS must be non-empty");
  }

  const bot = new Bot(config.telegram.token);
  const botInfo = await bot.api.getMe();
  const botUsername = botInfo.username;

  setCronDeliveryHandler(async (target, text) => {
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

    const chatActionManager = new TelegramChatActionManager({
      send: () => ctx.replyWithChatAction("typing"),
      logLabel: label,
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

  console.log(`Starting service (version: ${version}, home: ${config.home}, channel: telegram)`);

  const botRunner = run(bot, {
    sink: {
      // @grammyjs/runner defaults to 500; keep acpella conservative because prompts spawn child agents.
      concurrency: 5,
    },
  });
  await botRunner.task();
}
