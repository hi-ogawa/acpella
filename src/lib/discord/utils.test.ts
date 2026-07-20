import type { Message } from "discord.js";
import { expect, test } from "vitest";
import {
  DISCORD_PROMPT_NONCE_PREFIX,
  formatDiscordConversationMetadata,
  formatDiscordSessionName,
  formatDiscordThinking,
  getDiscordSelfMessageKind,
  getDiscordTargetRejection,
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
    author: { id: "bot" },
    id: "message",
    channelId: "channel",
  };
  expect(
    getDiscordSelfMessageKind({
      message: { ...message, id: "channel" } as Message,
      botUserId: "bot",
    }),
  ).toBe("starter");
  expect(
    getDiscordSelfMessageKind({
      message: { ...message, nonce: `${DISCORD_PROMPT_NONCE_PREFIX}123` } as Message,
      botUserId: "bot",
    }),
  ).toBe("prompt");
  expect(
    getDiscordSelfMessageKind({ message: message as Message, botUserId: "bot" }),
  ).toBeUndefined();
  expect(
    getDiscordSelfMessageKind({
      message: {
        ...message,
        author: { id: "other-bot" },
        nonce: `${DISCORD_PROMPT_NONCE_PREFIX}123`,
      } as Message,
      botUserId: "bot",
    }),
  ).toBeUndefined();
});

test("discord target allowlists", () => {
  const target = {
    guildId: "guild",
    channelId: "channel",
    allowedGuildIds: ["guild"],
    allowedChannelIds: ["channel"],
  };
  expect(getDiscordTargetRejection(target)).toBeUndefined();
  expect(
    getDiscordTargetRejection({
      ...target,
      channelId: "thread",
      parentChannelId: "channel",
    }),
  ).toBeUndefined();
  expect(getDiscordTargetRejection({ ...target, guildId: "other" })).toBe("guild");
  expect(getDiscordTargetRejection({ ...target, channelId: "other" })).toBe("channel");
});
