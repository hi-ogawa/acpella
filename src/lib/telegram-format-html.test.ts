import path from "node:path";
import { describe, expect, it } from "vitest";
import { toTelegramHtml } from "./telegram-format-html.ts";

describe("fixtures", () => {
  const fixtures: Record<string, () => Promise<any>> = import.meta.glob(
    ["../../fixtures/telegram-html/*.md", "!**/*.snap.*"],
    {
      query: "raw",
    },
  );

  for (const [file, mod] of Object.entries(fixtures)) {
    it(path.basename(file), async () => {
      const input = (await mod()).default;
      await expect(toTelegramHtml(input)).toMatchFileSnapshot(file + ".snap.html");
    });
  }
});
