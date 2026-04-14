import path from "node:path";
import { describe, expect, test } from "vitest";
import { readOptionalPromptFile } from "./prompt.ts";

describe(readOptionalPromptFile, () => {
  test("expands line-only path includes relative to the including file", () => {
    const fixture = path.join(import.meta.dirname, "../../fixtures/prompt-includes/AGENTS.md");

    expect(readOptionalPromptFile(fixture)).toMatchInlineSnapshot(`
      "before
      identity
      tools
      inline @./partials/identity.md stays literal
      after
      "
    `);
  });
});
