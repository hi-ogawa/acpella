import path from "node:path";
import { describe, expect, it } from "vitest";
import { markdownToTelegramHtml } from "./telegram-format-html.ts";

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
      let output = markdownToTelegramHtml(input);
      if (!output.endsWith("\n")) {
        output += "\n";
      }
      await expect(output).toMatchFileSnapshot(file + ".snap.html");
    });
  }
});
