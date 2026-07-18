import fs from "node:fs";
import type { HandlerExtraCommandGroup } from "../../handler.ts";
import { createDiscordForumPost, createDiscordMessage, getDiscordChannel } from "./api.ts";
import { formatDiscordSessionName } from "./utils.ts";

export function defineDiscordCommands(options: {
  token: string;
  allowedGuildIds: string[];
  allowedChannelIds: string[];
}): HandlerExtraCommandGroup {
  // Mirror the inbound message allowlists so acpella only posts where it serves.
  async function validateChannelTarget(channelId: string): Promise<void> {
    const channel = await getDiscordChannel({ token: options.token, channelId });
    if (!channel.guildId || !options.allowedGuildIds.includes(channel.guildId)) {
      throw new Error(`Guild is not allowed: ${channel.guildId ?? "(none)"}`);
    }
    if (options.allowedChannelIds.length && !options.allowedChannelIds.includes(channelId)) {
      throw new Error(`Channel is not allowed: ${channelId}`);
    }
  }

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
          await validateChannelTarget(parsed.channelId);
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
        usage: "/discord send-file [<channel-id>] <path>",
        description: "Send a local file to a channel.",
        withArgs: true,
        run: async ({ args, reply, usage, metadata }) => {
          if (args.length === 0) {
            await reply.system(usage);
            return;
          }
          const parsed = parseDiscordSendFileArgs({ args });
          const channelId = parsed.channelId ?? metadata?.cronDeliveryTarget?.discord?.channelId;
          if (!channelId) {
            throw new Error("Missing <channel-id>: no discord conversation to default to");
          }
          if (!fs.existsSync(parsed.path)) {
            throw new Error(`File not found: ${parsed.path}`);
          }
          await validateChannelTarget(channelId);
          await createDiscordMessage({
            token: options.token,
            channelId,
            filePaths: [parsed.path],
          });
          await reply.system(`Sent file to ${formatDiscordSessionName(channelId)}.`);
        },
      },
    ],
  };
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

export function parseDiscordSendFileArgs(options: { args: string[] }): {
  channelId?: string;
  path: string;
} {
  if (options.args.length === 1) {
    return { path: options.args[0]! };
  }
  if (options.args.length === 2) {
    const [channelId, path] = options.args;
    if (!/^\d+$/.test(channelId!)) {
      throw new Error(`Invalid channel id: ${channelId}`);
    }
    return { channelId, path: path! };
  }
  throw new Error(`Invalid arguments: ${options.args.join(" ")}`);
}
