import type { Context } from "grammy";
import { describe, expect, it } from "vitest";
import { buildMessageRuntimeMetadata, formatPromptWithMessageMetadata } from "./handler.ts";

describe(buildMessageRuntimeMetadata, () => {
  it("builds Telegram DM metadata with an offset timestamp", () => {
    const metadata = buildMessageRuntimeMetadata({
      context: {
        chat: { id: 123, type: "private" },
        from: { id: 456 },
        message: { message_id: 789 },
      } as Context,
      receivedAt: new Date("2026-04-13T01:02:03Z"),
    });

    expect(metadata).toMatchObject({
      surface: "telegram",
      chat_type: "dm",
      chat_id: "123",
      message_id: "789",
      sender_id: "456",
    });
    expect(metadata.received_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(metadata.timezone).toBeTruthy();
  });

  it("maps non-private Telegram chats to group metadata", () => {
    const metadata = buildMessageRuntimeMetadata({
      context: {
        chat: { id: -100, type: "supergroup" },
        message: { message_id: 42 },
      } as Context,
      receivedAt: new Date("2026-04-13T01:02:03Z"),
    });

    expect(metadata.chat_type).toBe("group");
    expect(metadata.sender_id).toBeUndefined();
  });
});

describe(formatPromptWithMessageMetadata, () => {
  it("prepends a concise metadata block to the user text", () => {
    expect(
      formatPromptWithMessageMetadata({
        metadata: {
          received_at: "2026-04-13T10:02:03+09:00",
          timezone: "Asia/Tokyo",
          surface: "telegram",
          chat_type: "dm",
          chat_id: "123",
          message_id: "789",
          sender_id: "456",
        },
        userText: "hello world",
      }),
    ).toMatchInlineSnapshot(`
      "<message_metadata>
      received_at: 2026-04-13T10:02:03+09:00
      timezone: Asia/Tokyo
      surface: telegram
      chat_type: dm
      chat_id: 123
      message_id: 789
      sender_id: 456
      </message_metadata>

      hello world"
    `);
  });
});
