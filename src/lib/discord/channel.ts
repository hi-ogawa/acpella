import fs from "node:fs";
import type { HandlerExtraCommandGroup } from "../../handler.ts";
import { createDiscordForumPost, createDiscordMessage, getDiscordChannel } from "./api.ts";
import { formatDiscordSessionName } from "./utils.ts";

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
        run: async ({ args, text, reply, usage }) => {
          if (args.length === 0) {
            await reply.system(usage);
            return;
          }
          const parsed = parseDiscordNewSessionArgs({ args, text });
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
}): Promise<void> {
  const channel = await getDiscordChannel({ token: options.token, channelId: options.channelId });
  if (!channel.guild_id || !options.allowedGuildIds.includes(channel.guild_id)) {
    throw new Error(`Guild is not allowed: ${channel.guild_id ?? "(none)"}`);
  }
  // an allowlisted parent channel admits its threads (mirrors the inbound guard)
  const parentChannelId = DISCORD_THREAD_CHANNEL_TYPES.has(channel.type)
    ? channel.parent_id
    : undefined;
  if (
    options.allowedChannelIds.length &&
    !options.allowedChannelIds.includes(options.channelId) &&
    !(parentChannelId && options.allowedChannelIds.includes(parentChannelId))
  ) {
    throw new Error(`Channel is not allowed: ${options.channelId}`);
  }
}

export function parseDiscordNewSessionArgs(options: { args: string[]; text: string }): {
  channelId: string;
  title: string;
  text: string;
} {
  const [channelId, ...rest] = options.args;
  if (!channelId) {
    throw new Error("Missing forum channel id");
  }
  if (!/^\d+$/.test(channelId)) {
    throw new Error(`Invalid forum channel id: ${channelId}`);
  }

  const separatorIndex = rest.indexOf("--");
  if (separatorIndex === -1) {
    throw new Error("Missing `-- <text>`");
  }
  const title = rest.slice(0, separatorIndex).join(" ");
  if (!title) {
    throw new Error("Missing title");
  }

  // Take the text from the raw command string instead of the tokens, which
  // are whitespace-split and would collapse newlines in a multi-line handoff.
  // TODO: replace with a first-class `--` body from the command layer (#309).
  const rawText = /\s--\s+([\s\S]+)$/.exec(options.text)?.[1]?.trim();
  if (!rawText) {
    throw new Error("Missing `-- <text>`");
  }

  return { channelId, title, text: rawText };
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
