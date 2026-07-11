export function formatDiscordSessionName(channelId: string): string {
  return `discord:${channelId}`;
}

export function formatDiscordThinking(text: string): string {
  const content = text
    .split("\n")
    .filter((line) => !/^\s*<!--\s*-->\s*$/.test(line))
    .join("\n")
    .trim();
  if (!content) {
    return "";
  }
  return content
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

export function parseDiscordSessionName(sessionName: string): { channelId: string } | undefined {
  const match = /^discord:(\d+)$/.exec(sessionName);
  if (!match) {
    return;
  }
  return { channelId: match[1]! };
}

export function formatDiscordConversationMetadata(options: {
  guildId?: string;
  channelId: string;
  isDirectMessage: boolean;
}): string {
  if (options.isDirectMessage) {
    return `discord:dm:${options.channelId}`;
  }
  return `discord:guild:${options.guildId ?? "unknown"}:channel:${options.channelId}`;
}
