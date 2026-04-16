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

test("acpella skills directive", () => {
  const root = process.cwd();
  const output = buildFirstPrompt({
    promptFile: path.resolve("./fixtures/prompt-directives/AGENTS.md"),
    text: "my first message",
  });
  expect(output.replaceAll(root, "<root>")).toMatchInlineSnapshot(`
    "Use these additional instructions for this session:

    <custom_instructions>
    before
    ### Available Skills

    When a task matches one of these skills, read the listed SKILL.md before acting.

    - alpha
      Description: Alpha skill description.
      File: <root>/fixtures/prompt-directives/skills/alpha/SKILL.md

    - beta
      Description: Beta skill description.
      File: <root>/fixtures/prompt-directives/skills/beta/SKILL.md

    ::acpella future ./thing
    inline ::acpella skills ./skills stays literal
    ::acpella skills ./missing
    after
    </custom_instructions>

    my first message"
  `);
});
