import path from "node:path";
import { expect, test } from "vitest";
import { buildFirstPrompt } from "./prompt.ts";

test("basic", () => {
  const output = buildFirstPrompt({
    promptFile: path.resolve("./fixtures/prompt-includes/AGENTS.md"),
    text: "my first message",
  });
  expect(output).toMatchInlineSnapshot(`
    "Use these additional instructions for this session:

    <custom_instructions>
    before
    identity
    tools
    @./missing.md
    cycle a
    cycle b
    @./cycle-a.md
    inline @./partials/identity.md stays literal
    after
    </custom_instructions>

    my first message"
  `);
});

test("not-found", () => {
  const output = buildFirstPrompt({
    promptFile: path.resolve("./fixtures/prompt-includes/MISSING.md"),
    text: "my first message",
  });
  expect(output).toMatchInlineSnapshot(`"my first message"`);
});
