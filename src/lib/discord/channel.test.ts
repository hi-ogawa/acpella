import { describe, expect, it } from "vitest";
import { parseDiscordNewSessionArgs, parseDiscordSendFileArgs } from "./channel.ts";

describe(parseDiscordNewSessionArgs, () => {
  function parse(text: string) {
    const tokens = text.trim().slice(1).split(/\s+/);
    return parseDiscordNewSessionArgs({ args: tokens.slice(2), text });
  }

  it("parses channel id, title, and text", () => {
    expect(parse("/discord new-session 123 Fix cron timezone bug -- Investigate the bug.")).toEqual(
      {
        channelId: "123",
        title: "Fix cron timezone bug",
        text: "Investigate the bug.",
      },
    );
  });

  it("preserves newlines in text", () => {
    const parsed = parse(`/discord new-session 123 My task -- Context:

- first
- second`);
    expect(parsed.text).toBe("Context:\n\n- first\n- second");
  });

  it("keeps later separators inside text", () => {
    const parsed = parse("/discord new-session 123 t -- a -- b");
    expect(parsed.text).toBe("a -- b");
  });

  it("rejects missing or invalid parts", () => {
    expect(() => parse("/discord new-session")).toThrow("Missing forum channel id");
    expect(() => parse("/discord new-session discord:forum:123 t -- x")).toThrow(
      "Invalid forum channel id: discord:forum:123",
    );
    expect(() => parse("/discord new-session 123 title only")).toThrow("Missing `-- <text>`");
    expect(() => parse("/discord new-session 123 -- text")).toThrow("Missing title");
    expect(() => parse("/discord new-session 123 title --")).toThrow("Missing `-- <text>`");
  });
});

describe(parseDiscordSendFileArgs, () => {
  it("parses path with and without channel id", () => {
    expect(parseDiscordSendFileArgs({ args: ["./out/chart.png"] })).toEqual({
      path: "./out/chart.png",
    });
    expect(parseDiscordSendFileArgs({ args: ["123", "./out/chart.png"] })).toEqual({
      channelId: "123",
      path: "./out/chart.png",
    });
  });

  it("rejects invalid arguments", () => {
    expect(() => parseDiscordSendFileArgs({ args: ["abc", "./x"] })).toThrow(
      "Invalid channel id: abc",
    );
    expect(() => parseDiscordSendFileArgs({ args: ["123", "./x", "extra"] })).toThrow(
      "Invalid arguments: 123 ./x extra",
    );
  });
});
