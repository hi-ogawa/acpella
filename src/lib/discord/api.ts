import fs from "node:fs";
import path from "node:path";

const DISCORD_API_BASE = "https://discord.com/api/v10";

// https://docs.discord.com/developers/resources/channel#create-message
export async function createDiscordMessage(options: {
  token: string;
  channelId: string;
  text?: string;
  filePaths?: string[];
  nonce?: string;
  enforceNonce?: boolean;
}): Promise<{ messageId: string }> {
  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify({
      content: options.text ?? "",
      ...(options.nonce ? { nonce: options.nonce } : {}),
      ...(options.enforceNonce ? { enforce_nonce: true } : {}),
    }),
  );
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
  const data = (await response.json()) as { id: string };
  return { messageId: data.id };
}

// https://docs.discord.com/developers/resources/channel#get-channel
export async function getDiscordChannel(options: {
  token: string;
  channelId: string;
}): Promise<{ guild_id?: string; type: number; parent_id?: string | null }> {
  const response = await fetch(`${DISCORD_API_BASE}/channels/${options.channelId}`, {
    headers: {
      authorization: `Bot ${options.token}`,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord API error: ${response.status} ${response.statusText}\n${body}`);
  }
  return await response.json();
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
