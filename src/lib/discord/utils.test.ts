import { MessageType } from "discord.js";
import { expect, test } from "vitest";
import {
  formatDiscordConversationMetadata,
  formatDiscordSessionName,
  parseDiscordThreadNameChangeEvent,
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

test("discord thread name changed event", () => {
  expect(
    parseDiscordThreadNameChangeEvent({
      messageType: MessageType.ChannelNameChange,
      system: true,
      content: "New title",
      isThread: true,
      threadName: "New title",
    }),
  ).toEqual({
    event: "thread_name_changed",
    newThreadName: "New title",
  });

  expect(
    parseDiscordThreadNameChangeEvent({
      messageType: MessageType.ChannelNameChange,
      system: true,
      content: "Old title",
      isThread: true,
      threadName: "New title",
    }),
  ).toEqual({
    event: "thread_name_changed",
    oldThreadName: "Old title",
    newThreadName: "New title",
  });

  expect(
    parseDiscordThreadNameChangeEvent({
      messageType: MessageType.ChannelNameChange,
      system: true,
      content: "",
      isThread: true,
      threadName: null,
    }),
  ).toBeUndefined();

  expect(
    parseDiscordThreadNameChangeEvent({
      messageType: MessageType.Default,
      system: true,
      content: "x",
      isThread: true,
      threadName: "x",
    }),
  ).toBeUndefined();
});
