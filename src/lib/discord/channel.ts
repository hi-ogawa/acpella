import type { CreateChannelSession } from "../channel/command.ts";
import { createDiscordForumPost } from "./api.ts";
import { formatDiscordSessionName } from "./utils.ts";

export function createDiscordChannelSession(options: { token?: string }): CreateChannelSession {
  return async ({ address, title, text }) => {
    if (!address.startsWith("discord:")) {
      return undefined;
    }
    const match = /^discord:forum:(\d+)$/.exec(address);
    if (!match) {
      throw new Error(`\
Unsupported discord channel address: ${address}
Supported: discord:forum:<forum-channel-id>`);
    }
    if (!options.token) {
      throw new Error("ACPELLA_DISCORD_BOT_TOKEN is required");
    }
    const result = await createDiscordForumPost({
      token: options.token,
      channelId: match[1]!,
      title,
      text,
    });
    return {
      reply: `\
Created discord forum post.
session: ${formatDiscordSessionName(result.threadId)}
url: ${result.url}`,
    };
  };
}
