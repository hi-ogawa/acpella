import { describe, expect, it } from "vitest";
import { parseDiscordNewSessionArgs } from "./channel.ts";

describe(parseDiscordNewSessionArgs, () => {
  it("parses channel id, title, and text", () => {
    expect(
      parseDiscordNewSessionArgs({
        args: ["123", "Fix", "cron", "timezone", "bug"],
        body: "Investigate the bug.",
      }),
    ).toEqual({
      channelId: "123",
      title: "Fix cron timezone bug",
      text: "Investigate the bug.",
    });
  });

  it("preserves newlines in text", () => {
    const parsed = parseDiscordNewSessionArgs({
      args: ["123", "My", "task"],
      body: "Context:\n\n- first\n- second",
    });
    expect(parsed.text).toBe("Context:\n\n- first\n- second");
  });

  it("keeps later separators inside text", () => {
    const parsed = parseDiscordNewSessionArgs({ args: ["123", "t"], body: "a -- b" });
    expect(parsed.text).toBe("a -- b");
  });

  it("rejects missing or invalid parts", () => {
    expect(() => parseDiscordNewSessionArgs({ args: [] })).toThrow("Missing forum channel id");
    expect(() =>
      parseDiscordNewSessionArgs({ args: ["discord:forum:123", "t"], body: "x" }),
    ).toThrow("Invalid forum channel id: discord:forum:123");
    expect(() => parseDiscordNewSessionArgs({ args: ["123", "title", "only"] })).toThrow(
      "Missing `-- <text>`",
    );
    expect(() => parseDiscordNewSessionArgs({ args: ["123"], body: "text" })).toThrow(
      "Missing title",
    );
    expect(() => parseDiscordNewSessionArgs({ args: ["123", "title"], body: "" })).toThrow(
      "Missing `-- <text>`",
    );
  });
});
