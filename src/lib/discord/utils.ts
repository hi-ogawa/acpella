export function formatDiscordSessionName(channelId: string): string {
  return `discord:${channelId}`;
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

export function buildDiscordPromptText({
  content,
  attachments,
}: {
  content: string;
  attachments: { localPath: string; isImage: boolean }[];
}): string {
  const parts: string[] = [];
  if (content) {
    parts.push(content);
  }
  for (const attachment of attachments) {
    if (attachment.isImage) {
      parts.push(`[User uploaded image: ${attachment.localPath}]`);
    } else {
      parts.push(`[User uploaded file: ${attachment.localPath}]`);
    }
  }
  return parts.join("\n\n");
}
