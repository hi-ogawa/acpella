import { describe, expect, it } from "vitest";
import { buildTelegramReply, escapeTelegramMarkdownV2 } from "./telegram-format.ts";

describe("escapeTelegramMarkdownV2", () => {
  it("escapes Telegram MarkdownV2 special characters", () => {
    expect(escapeTelegramMarkdownV2("_*[]()~`>#+-=|{}.!\\")).toBe(
      "\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\",
    );
  });

  it("leaves ordinary text unchanged", () => {
    expect(escapeTelegramMarkdownV2("hello world 123")).toBe("hello world 123");
  });
});

describe("buildTelegramReply", () => {
  it("returns MarkdownV2 reply payload", () => {
    expect(buildTelegramReply("a.b")).toEqual({
      text: "a\\.b",
      parse_mode: "MarkdownV2",
    });
  });
});
