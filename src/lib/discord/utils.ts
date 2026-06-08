import { MessageType } from "discord.js";

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

export function parseDiscordThreadNameChangeEvent(options: {
  messageType: number;
  system: boolean;
  content: string;
  isThread: boolean;
  threadName: string | null;
}):
  | {
      event: "thread_name_changed";
      newThreadName: string;
      oldThreadName?: string;
    }
  | undefined {
  if (
    !options.system ||
    options.messageType !== MessageType.ChannelNameChange ||
    !options.isThread
  ) {
    return;
  }

  const content = options.content.trim();
  const newThreadName = options.threadName ?? content;
  if (!newThreadName) {
    return;
  }

  const oldThreadName = content && content !== newThreadName ? content : undefined;
  return {
    event: "thread_name_changed",
    newThreadName,
    ...(oldThreadName ? { oldThreadName } : {}),
  };
}
