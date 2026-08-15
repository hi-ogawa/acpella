import type { Message } from "discord.js";

export const DISCORD_PROMPT_NONCE_PREFIX = "acpella-prompt:";

export function formatDiscordSessionName(channelId: string): string {
  return `discord:${channelId}`;
}

export function formatDiscordThinking(text: string): string {
  const content = text.trim();
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

export function checkDiscordTargetAccess(options: {
  guildId?: string;
  channelId: string;
  parentChannelId?: string;
  allowedGuildIds: readonly string[];
  allowedChannelIds: readonly string[];
}): { allowed: true } | { allowed: false; reason: "guild" | "channel" } {
  if (!options.guildId || !options.allowedGuildIds.includes(options.guildId)) {
    return { allowed: false, reason: "guild" };
  }
  if (
    options.allowedChannelIds.length > 0 &&
    !options.allowedChannelIds.includes(options.channelId) &&
    !(options.parentChannelId && options.allowedChannelIds.includes(options.parentChannelId))
  ) {
    return { allowed: false, reason: "channel" };
  }
  return { allowed: true };
}

export function checkDiscordMessageAuthor(options: {
  message: Message;
  botUserId?: string;
}): "allowed-bot" | "disallowed-bot" | "user" {
  if (!options.message.author.bot) {
    return "user";
  }

  // Allow only the bot's own messages used to start or resume a session.
  if (options.message.author.id === options.botUserId) {
    // A forum-post starter has the same message and channel id.
    if (options.message.id === options.message.channelId) {
      return "allowed-bot";
    }

    // `/discord send-message` adds this marker. The nonce is not authentication;
    // Discord's message author identifies the bot.
    if (
      typeof options.message.nonce === "string" &&
      options.message.nonce.startsWith(DISCORD_PROMPT_NONCE_PREFIX)
    ) {
      return "allowed-bot";
    }
  }

  return "disallowed-bot";
}
