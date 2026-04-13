import { describe, expect, it } from "vitest";
import { telegramSequentialKey, telegramSessionName } from "./telegram.ts";

describe(telegramSessionName, () => {
  it("formats direct chat sessions", () => {
    expect(telegramSessionName({ chatId: 123 })).toBe("tg-123");
  });

  it("formats threaded chat sessions", () => {
    expect(telegramSessionName({ chatId: -100, threadId: 42 })).toBe("tg--100-42");
  });
});

describe(telegramSequentialKey, () => {
  it("uses the session key for normal direct chat messages", () => {
    expect(
      telegramSequentialKey({
        chat: { id: 123 },
        message: { text: "hello" },
      }),
    ).toBe("tg-123");
  });

  it("uses the session key for normal forum topic messages", () => {
    expect(
      telegramSequentialKey({
        chat: { id: -100 },
        message: { text: "hello", message_thread_id: 42 },
      }),
    ).toBe("tg--100-42");
  });

  it("uses a control key for exact cancel commands", () => {
    expect(
      telegramSequentialKey({
        chat: { id: -100 },
        message: { text: "/cancel", message_thread_id: 42 },
      }),
    ).toBe("tg--100-42:control");
  });

  it("does not put other local commands on the control key", () => {
    expect(
      telegramSequentialKey({
        chat: { id: 123 },
        message: { text: "/status" },
      }),
    ).toBe("tg-123");
    expect(
      telegramSequentialKey({
        chat: { id: 123 },
        message: { text: "/session" },
      }),
    ).toBe("tg-123");
  });
});
