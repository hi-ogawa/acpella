import { Client, GatewayIntentBits, Partials } from "discord.js";
import type { AppConfig } from "../../config.ts";
import type { Handler } from "../../handler.ts";
import { addIndent, truncateString } from "../../utils/index.ts";
import { stringifyError } from "../../utils/node.ts";
import { TypingIndicatorManager } from "../channel/typing-indicator.ts";
import type { CronDeliveryHandler } from "../cron/runner.ts";
import { DISCORD_MESSAGE_SPLIT_BUDGET } from "../reply.ts";
import { downloadDiscordAttachment } from "./file.ts";
import {
  formatDiscordConversationMetadata,
  formatDiscordSessionName,
  formatDiscordThinking,
} from "./utils.ts";

export async function serveDiscord(options: {
  config: AppConfig["discord"];
  handler: Handler;
  registerCronDeliveryHandler: (handler: CronDeliveryHandler) => void;
}) {
  const { config, handler, registerCronDeliveryHandler } = options;

  if (!config.token) {
    throw new Error("ACPELLA_DISCORD_BOT_TOKEN is required");
  }
  if (config.allowedGuildIds.length === 0) {
    throw new Error("ACPELLA_DISCORD_ALLOWED_GUILD_IDS must be non-empty");
  }

  const allowedUsers = new Set(config.allowedUserIds);
  const allowedGuilds = new Set(config.allowedGuildIds);
  const allowedChannels = new Set(config.allowedChannelIds);

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

  client.on("messageCreate", async (message) => {
    // A message whose id equals its channel id is the starter of a thread-only
    // channel (e.g. a forum post). Admitting the bot's own starter lets a post
    // created by `/discord new-session` become that session's first prompt,
    // while all other bot-authored messages stay ignored (silently, unlike the
    // logged rejections below).
    const selfStarter = message.author.id === client.user?.id && message.id === message.channelId;
    if (message.author.bot && !selfStarter) {
      return;
    }

    const userId = message.author.id;
    const guildId = message.guildId ?? undefined;
    const channelId = message.channelId;
    const sessionName = formatDiscordSessionName(channelId);
    const label = `[${sessionName}:${message.id}]`;

    // an allowlisted parent channel admits its threads
    const parentChannelId = message.channel.isThread() ? message.channel.parentId : undefined;
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
    if (!selfStarter && allowedUsers.size && !allowedUsers.has(userId)) {
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
  });

  client.on("error", (error) => {
    console.error("[discord] client error", error);
  });

  await client.login(config.token);
  return client;
}
