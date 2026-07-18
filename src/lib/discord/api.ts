const DISCORD_API_BASE = "https://discord.com/api/v10";

// https://docs.discord.com/developers/resources/channel#get-channel
export async function getDiscordChannel(options: {
  token: string;
  channelId: string;
}): Promise<{ guildId?: string }> {
  const response = await fetch(`${DISCORD_API_BASE}/channels/${options.channelId}`, {
    headers: {
      authorization: `Bot ${options.token}`,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord API error: ${response.status} ${response.statusText}\n${body}`);
  }
  const data = (await response.json()) as { guild_id?: string };
  return { guildId: data.guild_id };
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
