import { randomBytes } from "node:crypto";
import fs from "node:fs";
import type { HandlerExtraCommandGroup } from "../../handler.ts";
import type { SplitArgs } from "../command.ts";
import { createDiscordForumPost, createDiscordMessage, getDiscordChannel } from "./api.ts";
import { formatDiscordSessionName } from "./utils.ts";

export const DISCORD_PROMPT_NONCE_PREFIX = "acpella-prompt:";

export function defineDiscordCommands(options: {
  token: string;
  allowedGuildIds: string[];
  allowedChannelIds: string[];
}): HandlerExtraCommandGroup {
  return {
    description: "Discord channel operations",
    commands: [
      {
        tokens: ["new-session"],
        usage: "/discord new-session <forum-channel-id> <title...> -- <text>",
        description: "Create a forum post as a new session.",
        withArgs: true,
        run: async ({ splitArgs, reply, usage }) => {
          if (splitArgs.head.length === 0) {
            await reply.system(usage);
            return;
          }
          const parsed = parseDiscordNewSessionArgs(splitArgs);
          await validateChannelTarget({ ...options, channelId: parsed.channelId });
          const result = await createDiscordForumPost({
            token: options.token,
            channelId: parsed.channelId,
            title: parsed.title,
            text: parsed.text,
          });
          await reply.system(`\
Created discord forum post.
session: ${formatDiscordSessionName(result.threadId)}
url: ${result.url}`);
        },
      },
      {
        tokens: ["send-message"],
        usage: "/discord send-message <channel-id> -- <text>",
        description: "Send a follow-up prompt to a channel session.",
        withArgs: true,
        run: async ({ splitArgs, reply, usage }) => {
          if (splitArgs.head.length === 0) {
            await reply.system(usage);
            return;
          }
          const parsed = parseDiscordSendMessageArgs(splitArgs);
          const target = await validateChannelTarget({ ...options, channelId: parsed.channelId });
          const result = await createDiscordMessage({
            token: options.token,
            channelId: parsed.channelId,
            text: parsed.text,
            nonce: createDiscordPromptNonce(),
            enforceNonce: true,
          });
          await reply.system(`\
Sent prompt to Discord session.
session: ${formatDiscordSessionName(parsed.channelId)}
url: https://discord.com/channels/${target.guildId}/${parsed.channelId}/${result.messageId}`);
        },
      },
      {
        tokens: ["send-file"],
        usage: "/discord send-file <channel-id> <path>",
        description: "Send a local file to a channel.",
        withArgs: true,
        run: async ({ args, reply, usage }) => {
          if (args.length === 0) {
            await reply.system(usage);
            return;
          }
          const parsed = parseDiscordSendFileArgs({ args });
          if (!fs.existsSync(parsed.path)) {
            throw new Error(`File not found: ${parsed.path}`);
          }
          await validateChannelTarget({ ...options, channelId: parsed.channelId });
          await createDiscordMessage({
            token: options.token,
            channelId: parsed.channelId,
            filePaths: [parsed.path],
          });
          await reply.system(`Sent file to ${formatDiscordSessionName(parsed.channelId)}.`);
        },
      },
    ],
  };
}

// https://docs.discord.com/developers/resources/channel#channel-object-channel-types
const DISCORD_THREAD_CHANNEL_TYPES = new Set([10, 11, 12]);

// Mirror the inbound message allowlists so acpella only posts where it serves.
async function validateChannelTarget(options: {
  token: string;
  allowedGuildIds: string[];
  allowedChannelIds: string[];
  channelId: string;
}): Promise<{ guildId: string }> {
  const channel = await getDiscordChannel({ token: options.token, channelId: options.channelId });
  const parentChannelId = DISCORD_THREAD_CHANNEL_TYPES.has(channel.type)
    ? (channel.parent_id ?? undefined)
    : undefined;
  const rejection = getDiscordTargetRejection({
    guildId: channel.guild_id,
    channelId: options.channelId,
    parentChannelId,
    allowedGuildIds: options.allowedGuildIds,
    allowedChannelIds: options.allowedChannelIds,
  });
  if (rejection === "guild") {
    throw new Error(`Guild is not allowed: ${channel.guild_id ?? "(none)"}`);
  }
  if (rejection === "channel") {
    throw new Error(`Channel is not allowed: ${options.channelId}`);
  }
  return { guildId: channel.guild_id! };
}

export function getDiscordTargetRejection(options: {
  guildId?: string;
  channelId: string;
  parentChannelId?: string;
  allowedGuildIds: readonly string[];
  allowedChannelIds: readonly string[];
}): "guild" | "channel" | undefined {
  if (!options.guildId || !options.allowedGuildIds.includes(options.guildId)) {
    return "guild";
  }
  if (
    options.allowedChannelIds.length > 0 &&
    !options.allowedChannelIds.includes(options.channelId) &&
    !(options.parentChannelId && options.allowedChannelIds.includes(options.parentChannelId))
  ) {
    return "channel";
  }
}

export function getDiscordSelfMessageKind(options: {
  authorId: string;
  botUserId?: string;
  messageId: string;
  channelId: string;
  nonce?: string | number | null;
}): "starter" | "prompt" | undefined {
  // Discord-authenticated bot identity is the trust check; nonce only classifies
  // which of this bot's own messages should enter normal prompt handling.
  if (options.authorId !== options.botUserId) {
    return;
  }
  if (options.messageId === options.channelId) {
    return "starter";
  }
  if (typeof options.nonce === "string" && options.nonce.startsWith(DISCORD_PROMPT_NONCE_PREFIX)) {
    return "prompt";
  }
}

export function createDiscordPromptNonce(): string {
  // The random suffix gives REST retries a unique deduplication key, not authentication.
  return DISCORD_PROMPT_NONCE_PREFIX + randomBytes(5).toString("hex");
}

function parseDiscordNewSessionArgs(splitArgs: SplitArgs): {
  channelId: string;
  title: string;
  text: string;
} {
  const [channelId, ...titleParts] = splitArgs.head;
  if (!channelId) {
    throw new Error("Missing forum channel id");
  }
  if (!/^\d+$/.test(channelId)) {
    throw new Error(`Invalid forum channel id: ${channelId}`);
  }

  const title = titleParts.join(" ");
  if (!title) {
    throw new Error("Missing title");
  }

  if (!splitArgs.body?.trim()) {
    throw new Error("Missing `-- <text>`");
  }

  return { channelId, title, text: splitArgs.body };
}

function parseDiscordSendMessageArgs(splitArgs: SplitArgs): {
  channelId: string;
  text: string;
} {
  const [channelId, ...extra] = splitArgs.head;
  if (!channelId) {
    throw new Error("Missing channel id");
  }
  if (!/^\d+$/.test(channelId)) {
    throw new Error(`Invalid channel id: ${channelId}`);
  }
  if (extra.length > 0) {
    throw new Error(`Invalid arguments: ${splitArgs.head.join(" ")}`);
  }
  if (!splitArgs.body?.trim()) {
    throw new Error("Missing `-- <text>`");
  }
  return { channelId, text: splitArgs.body };
}

function parseDiscordSendFileArgs(options: { args: string[] }): {
  channelId: string;
  path: string;
} {
  const [channelId, path, ...extra] = options.args;
  if (!channelId || !path || extra.length > 0) {
    throw new Error(`Invalid arguments: ${options.args.join(" ")}`);
  }
  if (!/^\d+$/.test(channelId)) {
    throw new Error(`Invalid channel id: ${channelId}`);
  }
  return { channelId, path };
}
