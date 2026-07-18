import { createDiscordForumPost } from "./api.ts";
import { formatDiscordSessionName } from "./utils.ts";

export async function createDiscordChannelSession(options: {
  token?: string;
  address: string;
  title: string;
  text: string;
}): Promise<string> {
  const match = /^discord:forum:(\d+)$/.exec(options.address);
  if (!match) {
    throw new Error(`\
Unsupported channel address: ${options.address}
Supported: discord:forum:<forum-channel-id>`);
  }
  if (!options.token) {
    throw new Error("ACPELLA_DISCORD_BOT_TOKEN is required");
  }
  const result = await createDiscordForumPost({
    token: options.token,
    channelId: match[1]!,
    title: options.title,
    text: options.text,
  });
  return `\
Created discord forum post.
session: ${formatDiscordSessionName(result.threadId)}
url: ${result.url}`;
}
