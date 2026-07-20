import type { Message } from "discord.js";
import { expect, test } from "vitest";
import {
  checkDiscordMessageAuthor,
  checkDiscordTargetAccess,
  DISCORD_PROMPT_NONCE_PREFIX,
  formatDiscordConversationMetadata,
  formatDiscordSessionName,
  formatDiscordThinking,
  parseDiscordSessionName,
} from "./utils.ts";

test("discord session name", () => {
  expect(formatDiscordSessionName("123")).toBe("discord:123");
  expect(parseDiscordSessionName("discord:123")).toEqual({ channelId: "123" });
  expect(parseDiscordSessionName("discord:abc")).toBe(undefined);
});

test("discord metadata", () => {
  expect(
    formatDiscordConversationMetadata({
      channelId: "123",
      isDirectMessage: true,
    }),
  ).toBe("discord:dm:123");
  expect(
    formatDiscordConversationMetadata({
      guildId: "456",
      channelId: "123",
      isDirectMessage: false,
    }),
  ).toBe("discord:guild:456:channel:123");
});

test("discord thinking", () => {
  expect(formatDiscordThinking("[thinking] Inspect the source")).toMatchInlineSnapshot(
    `"> [thinking] Inspect the source"`,
  );
  expect(formatDiscordThinking("[thinking] Inspect the source\n\nThen run tests"))
    .toMatchInlineSnapshot(`
    "> [thinking] Inspect the source
    >
    > Then run tests"
  `);
});

test("discord self messages", () => {
  const message = {
    author: { id: "bot", bot: true },
    id: "message",
    channelId: "channel",
  };
  expect(
    checkDiscordMessageAuthor({
      message: { ...message, id: "channel" } as Message,
      botUserId: "bot",
    }),
  ).toBe("allowed-bot");
  expect(
    checkDiscordMessageAuthor({
      message: { ...message, nonce: `${DISCORD_PROMPT_NONCE_PREFIX}123` } as Message,
      botUserId: "bot",
    }),
  ).toBe("allowed-bot");
  expect(checkDiscordMessageAuthor({ message: message as Message, botUserId: "bot" })).toBe(
    "disallowed-bot",
  );
  expect(
    checkDiscordMessageAuthor({
      message: {
        ...message,
        author: { id: "other-bot", bot: true },
        nonce: `${DISCORD_PROMPT_NONCE_PREFIX}123`,
      } as Message,
      botUserId: "bot",
    }),
  ).toBe("disallowed-bot");
  expect(
    checkDiscordMessageAuthor({
      message: { ...message, author: { id: "user", bot: false } } as Message,
      botUserId: "bot",
    }),
  ).toBe("user");
});

test("discord target allowlists", () => {
  expect(
    checkDiscordTargetAccess({
      guildId: "guild",
      channelId: "channel",
      allowedGuildIds: ["guild"],
      allowedChannelIds: ["channel"],
    }),
  ).toEqual({ allowed: true });
  expect(
    checkDiscordTargetAccess({
      guildId: "guild",
      channelId: "thread",
      parentChannelId: "channel",
      allowedGuildIds: ["guild"],
      allowedChannelIds: ["channel"],
    }),
  ).toEqual({ allowed: true });
  expect(
    checkDiscordTargetAccess({
      guildId: "guild",
      channelId: "any-channel",
      allowedGuildIds: ["guild"],
      allowedChannelIds: [],
    }),
  ).toEqual({ allowed: true });
  expect(
    checkDiscordTargetAccess({
      guildId: "other",
      channelId: "channel",
      allowedGuildIds: ["guild"],
      allowedChannelIds: ["channel"],
    }),
  ).toEqual({ allowed: false, reason: "guild" });
  expect(
    checkDiscordTargetAccess({
      guildId: "guild",
      channelId: "other",
      allowedGuildIds: ["guild"],
      allowedChannelIds: ["channel"],
    }),
  ).toEqual({ allowed: false, reason: "channel" });
});
