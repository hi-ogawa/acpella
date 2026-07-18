import fs from "node:fs";
import path from "node:path";

const DISCORD_API_BASE = "https://discord.com/api/v10";

// https://docs.discord.com/developers/resources/channel#create-message
export async function createDiscordMessage(options: {
  token: string;
  channelId: string;
  text?: string;
  filePaths?: string[];
}): Promise<void> {
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content: options.text ?? "" }));
  for (const [index, filePath] of (options.filePaths ?? []).entries()) {
    form.append(`files[${index}]`, new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  }
  const response = await fetch(`${DISCORD_API_BASE}/channels/${options.channelId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bot ${options.token}`,
    },
    body: form,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord API error: ${response.status} ${response.statusText}\n${body}`);
  }
}

// https://docs.discord.com/developers/resources/channel#get-channel
export async function getDiscordChannel(options: {
  token: string;
  channelId: string;
}): Promise<{ guildId?: string; type: number; parentId?: string }> {
  const response = await fetch(`${DISCORD_API_BASE}/channels/${options.channelId}`, {
    headers: {
      authorization: `Bot ${options.token}`,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord API error: ${response.status} ${response.statusText}\n${body}`);
  }
  const data = (await response.json()) as {
    guild_id?: string;
    type: number;
    parent_id?: string | null;
  };
  return { guildId: data.guild_id, type: data.type, parentId: data.parent_id ?? undefined };
}

// https://docs.discord.com/developers/resources/channel#start-thread-in-forum-or-media-channel
export async function createDiscordForumPost(options: {
  token: string;
  channelId: string;
  title: string;
  text: string;
}): Promise<{ threadId: string; url: string }> {
  const response = await fetch(`${DISCORD_API_BASE}/channels/${options.channelId}/threads`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bot ${options.token}`,
    },
    body: JSON.stringify({
      name: options.title,
      message: { content: options.text },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord API error: ${response.status} ${response.statusText}\n${body}`);
  }
  const data = (await response.json()) as { id: string; guild_id: string };
  return {
    threadId: data.id,
    url: `https://discord.com/channels/${data.guild_id}/${data.id}`,
  };
}
