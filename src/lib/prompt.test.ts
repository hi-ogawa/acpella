import fs from "node:fs";
import path from "node:path";
import { describe, expect, onTestFinished, test } from "vitest";
import { readOptionalPromptFile } from "./prompt.ts";

describe(readOptionalPromptFile, () => {
  test("expands line-only path includes relative to the including file", () => {
    const root = path.join(import.meta.dirname, `../../.tmp/test-prompt-${crypto.randomUUID()}`);
    fs.mkdirSync(path.join(root, "partials"), { recursive: true });
    onTestFinished(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    fs.writeFileSync(
      path.join(root, "AGENTS.md"),
      [
        "before",
        "@./partials/identity.md",
        "inline @./partials/identity.md stays literal",
        "after",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(root, "partials", "identity.md"),
      ["identity", "@../TOOLS.md", ""].join("\n"),
    );
    fs.writeFileSync(path.join(root, "TOOLS.md"), ["tools", ""].join("\n"));

    expect(readOptionalPromptFile(path.join(root, "AGENTS.md"))).toMatchInlineSnapshot(`
      "before
      identity
      tools
      inline @./partials/identity.md stays literal
      after
      "
    `);
  });
});
