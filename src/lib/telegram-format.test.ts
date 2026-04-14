import { describe, expect, it } from "vitest";
import { toTelegramMarkdownV2 } from "./telegram-format.ts";

describe(toTelegramMarkdownV2, () => {
  it("escapes plain MarkdownV2 special characters", () => {
    expect(toTelegramMarkdownV2("hello - world!")).toBe("hello \\- world\\!");
  });

  it("formats a conservative Markdown subset", () => {
    expect(
      toTelegramMarkdownV2(
        [
          "**bold** and `a_b`",
          "[OpenAI](https://example.com/docs)",
          "```ts",
          "const x = `value`;",
          "```",
        ].join("\n"),
      ),
    ).toBe(
      [
        "*bold* and `a_b`",
        "[OpenAI](https://example.com/docs)",
        "```ts",
        "const x = \\`value\\`;",
        "```",
      ].join("\n"),
    );
  });

  it("keeps malformed Markdown readable", () => {
    expect(toTelegramMarkdownV2("**open [link](missing")).toBe("\\*\\*open \\[link\\]\\(missing");
  });
});
