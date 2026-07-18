import type { HandlerExtraCommandGroup } from "../../handler.ts";
import { createDiscordForumPost, getDiscordChannel } from "./api.ts";
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
        withBody: true,
        run: async ({ args, body, reply, usage }) => {
          if (args.length === 0) {
            await reply.system(usage);
            return;
          }
          const parsed = parseDiscordNewSessionArgs({ args, body });

          // Mirror the inbound message allowlists so acpella only posts where it serves.
          const channel = await getDiscordChannel({
            token: options.token,
            channelId: parsed.channelId,
          });
          if (!channel.guildId || !options.allowedGuildIds.includes(channel.guildId)) {
            throw new Error(`Guild is not allowed: ${channel.guildId ?? "(none)"}`);
          }
          if (
            options.allowedChannelIds.length &&
            !options.allowedChannelIds.includes(parsed.channelId)
          ) {
            throw new Error(`Channel is not allowed: ${parsed.channelId}`);
          }

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
    ],
  };
}

export function parseDiscordNewSessionArgs(options: { args: string[]; body?: string }): {
  channelId: string;
  title: string;
  text: string;
} {
  const [channelId, ...titleParts] = options.args;
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

  if (!options.body?.trim()) {
    throw new Error("Missing `-- <text>`");
  }

  return { channelId, title, text: options.body };
}
