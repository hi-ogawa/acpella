import { describe, expect, it } from "vitest";
import { parseChannelNewSessionArgs } from "./command.ts";

describe(parseChannelNewSessionArgs, () => {
  function parse(text: string) {
    const tokens = text.trim().slice(1).split(/\s+/);
    return parseChannelNewSessionArgs({ args: tokens.slice(2), text });
  }

  it("parses address, title, and text", () => {
    expect(
      parse("/channel new-session discord:forum:123 Fix cron timezone bug -- Investigate the bug."),
    ).toEqual({
      address: "discord:forum:123",
      title: "Fix cron timezone bug",
      text: "Investigate the bug.",
    });
  });

  it("preserves newlines in text", () => {
    const parsed = parse(`/channel new-session discord:forum:123 My task -- Context:

- first
- second`);
    expect(parsed.text).toBe("Context:\n\n- first\n- second");
  });

  it("keeps later separators inside text", () => {
    const parsed = parse("/channel new-session discord:forum:123 t -- a -- b");
    expect(parsed.text).toBe("a -- b");
  });

  it("rejects missing parts", () => {
    expect(() => parse("/channel new-session")).toThrowError("Missing channel address");
    expect(() => parse("/channel new-session discord:forum:123 title only")).toThrowError(
      "Missing `-- <text>`",
    );
    expect(() => parse("/channel new-session discord:forum:123 -- text")).toThrowError(
      "Missing title",
    );
    expect(() => parse("/channel new-session discord:forum:123 title --")).toThrowError(
      "Missing `-- <text>`",
    );
  });
});
