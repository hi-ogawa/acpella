import path from "node:path";
import { expect, test } from "vitest";
import { buildFirstPrompt, buildMessageMetadataPrompt } from "./prompt.ts";

test("basic", () => {
  const output = buildFirstPrompt(path.resolve("./fixtures/prompt-includes/AGENTS.md"));
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
    "
  `);
});

test("not-found", () => {
  const output = buildFirstPrompt(path.resolve("./fixtures/prompt-includes/MISSING.md"));
  expect(output).toMatchInlineSnapshot(`""`);
});

test("acpella skills directive", () => {
  const root = process.cwd();
  const output = buildFirstPrompt(path.resolve("./fixtures/prompt-directives/AGENTS.md"));
  expect(output.replaceAll(root, "<root>")).toMatchInlineSnapshot(`
    "Use these additional instructions for this session:

    <custom_instructions>
    before
    - Skill directory: alpha
      File: <root>/fixtures/prompt-directives/skills/alpha/SKILL.md
      Frontmatter:
        ---
        name: alpha
        description: >-
          Alpha skill description.
        ---

    - Skill directory: beta
      File: <root>/fixtures/prompt-directives/skills/beta/SKILL.md
      Frontmatter:
        ---
        name: beta
        description: "Beta skill description."
        ---

    - Skill directory: no-description
      File: <root>/fixtures/prompt-directives/skills/no-description/SKILL.md
      Frontmatter:
        ---
        name: no-description
        ---

    ::acpella future ./thing
    inline ::acpella skills ./skills stays literal
    ::acpella skills ./missing
    after
    </custom_instructions>
    "
  `);
});

test("message metadata", () => {
  const output = buildMessageMetadataPrompt({
    timestamp: Date.UTC(2024, 0, 2, 3, 4, 5),
    timezone: "Asia/Tokyo",
    sessionName: "my-session",
  });
  expect(output).toMatchInlineSnapshot(`
    "<message_metadata>
    sender_timestamp: 2024-01-02T12:04:05+09:00
    timezone: Asia/Tokyo
    session_name: my-session
    </message_metadata>
    "
  `);
});
