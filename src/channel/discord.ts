import {
  Client,
  GatewayIntentBits,
  Partials,
  type MessageCreateOptions,
  type Message,
} from "discord.js";
import type { AppConfig } from "../config.ts";
import type { Handler } from "../handler.ts";
import type { CronDeliveryTarget } from "../lib/cron/store.ts";
import {
  formatDiscordConversationMetadata,
  formatDiscordSessionName,
} from "../lib/discord/utils.ts";
import { DISCORD_MESSAGE_SPLIT_BUDGET } from "../lib/reply.ts";
import { truncateString } from "../utils/index.ts";
import { stringifyError } from "../utils/node.ts";

export async function serveDiscord(options: {
  config: AppConfig;
  handler: Handler;
  version: string;
  setCronDeliveryHandler: (
    handler: (target: CronDeliveryTarget, text: string) => Promise<void>,
  ) => void;
}) {
  const { config, handler, version, setCronDeliveryHandler } = options;

  if (!config.discord.token) {
    throw new Error("ACPELLA_DISCORD_BOT_TOKEN is required");
  }
  if (config.discord.allowedUserIds.length === 0) {
    throw new Error("ACPELLA_DISCORD_ALLOWED_USER_IDS must be non-empty");
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

  setCronDeliveryHandler(async (target, text) => {
    if (!target.discord) {
      return;
    }
    const channel = await client.channels.fetch(target.discord.channelId);
    if (!channel?.isTextBased() || !isSendableChannel(channel)) {
      throw new Error(`Discord channel is not text-based: ${target.discord.channelId}`);
    }
    await sendDiscordMessage(channel, text);
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot) {
      return;
    }
    await handleDiscordMessage({
      message,
      handler,
      allowedUsers,
      allowedGuilds,
      allowedChannels,
    });
  });

  client.on("error", (error) => {
    console.error("[discord] client error", error);
  });

  console.log(`Starting service (version: ${version}, home: ${config.home}, channel: discord)`);
  await client.login(config.discord.token);
  await new Promise<never>(() => {});
}

async function handleDiscordMessage(options: {
  message: Message;
  handler: Handler;
  allowedUsers: Set<string>;
  allowedGuilds: Set<string>;
  allowedChannels: Set<string>;
}) {
  const { message, handler, allowedUsers, allowedGuilds, allowedChannels } = options;
  const userId = message.author.id;
  const guildId = message.guildId ?? undefined;
  const channelId = message.channelId;
  const sessionName = formatDiscordSessionName(channelId);
  const label = `[${sessionName}:${message.id}]`;

  if (allowedChannels.size && !allowedChannels.has(channelId)) {
    console.error(`${label} rejected: channel ${channelId} is not allowed`);
    return;
  }
  if (allowedGuilds.size && (!guildId || !allowedGuilds.has(guildId))) {
    console.error(`${label} rejected: guild ${guildId ?? "direct-message"} is not allowed`);
    return;
  }
  if (allowedUsers.size && !allowedUsers.has(userId)) {
    console.error(`${label} rejected: user ${userId} is not allowed`);
    return;
  }

  const text = message.content.trim();
  if (!text) {
    return;
  }
  const replyChannel = message.channel;
  if (!isSendableChannel(replyChannel)) {
    console.error(`${label} rejected: channel is not sendable`);
    return;
  }

  try {
    await handler.handle({
      sessionName,
      text,
      replyLimit: DISCORD_MESSAGE_SPLIT_BUDGET,
      metadata: {
        promptMetadata: {
          timestamp: message.createdTimestamp,
          channel: formatDiscordConversationMetadata({
            guildId,
            channelId,
            isDirectMessage: message.channel.isDMBased(),
          }),
        },
        cronDeliveryTarget: {
          discord: {
            channelId,
          },
        },
      },
      send: async (replyText) => {
        return await sendDiscordMessage(replyChannel, replyText);
      },
    });
    console.log(`${label} (response ok)`);
  } catch (error) {
    console.error(`${label} (response error)`, error);
    await sendDiscordMessage(
      replyChannel,
      `[acpella error]\n${truncateString(stringifyError(error), 1800)}`,
    );
  }
}

function isSendableChannel(channel: unknown): channel is {
  send: (content: string | MessageCreateOptions) => Promise<unknown>;
} {
  return (
    typeof channel === "object" &&
    channel !== null &&
    "send" in channel &&
    typeof channel.send === "function"
  );
}

async function sendDiscordMessage(
  channel: { send: (content: string | MessageCreateOptions) => Promise<unknown> },
  text: string,
) {
  await channel.send(text);
}
