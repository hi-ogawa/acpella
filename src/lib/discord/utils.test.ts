import { expect, test } from "vitest";
import {
  buildDiscordPromptText,
  formatDiscordConversationMetadata,
  formatDiscordSessionName,
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

test("buildDiscordPromptText - text only", () => {
  expect(buildDiscordPromptText({ content: "hello", attachments: [] })).toBe("hello");
});

test("buildDiscordPromptText - image attachment only", () => {
  expect(
    buildDiscordPromptText({
      content: "",
      attachments: [{ localPath: "/tmp/img.png", isImage: true }],
    }),
  ).toBe("[User uploaded image: /tmp/img.png]");
});

test("buildDiscordPromptText - file attachment only", () => {
  expect(
    buildDiscordPromptText({
      content: "",
      attachments: [{ localPath: "/tmp/doc.pdf", isImage: false }],
    }),
  ).toBe("[User uploaded file: /tmp/doc.pdf]");
});

test("buildDiscordPromptText - text + multiple attachments", () => {
  expect(
    buildDiscordPromptText({
      content: "see these files",
      attachments: [
        { localPath: "/tmp/img.png", isImage: true },
        { localPath: "/tmp/doc.pdf", isImage: false },
      ],
    }),
  ).toBe(
    "see these files\n\n[User uploaded image: /tmp/img.png]\n\n[User uploaded file: /tmp/doc.pdf]",
  );
});
