import { describe, expect, test } from "vitest";
import { sanitizeCliError, sanitizeOutput, useCli } from "./helper.ts";

describe("exec", () => {
  test("command", async () => {
    const cli = useCli();
    const result = await cli.cli("exec", "/service");
    expect(sanitizeOutput(result.stderr)).toMatchInlineSnapshot(`""`);
    expect(result.stdout).toMatchInlineSnapshot(`
      "[⚙️ System]
      /service
        /service systemd install - Install systemd service.
        /service exit - Exit acpella.
      "
    `);
  });

  test("prompt", async () => {
    const cli = useCli();
    const result = await cli.cli("exec", "__multiple_chunks:hello");
    expect(sanitizeOutput(result.stderr)).toMatchInlineSnapshot(`""`);
    expect(result.stdout).toMatchInlineSnapshot(`
      "echo-1: helloecho-2: hello
      "
    `);
  });

  test("hard error", async () => {
    const cli = useCli();
    await expect(cli.cli("exec", "/agent close-session invalid").catch(sanitizeCliError)).resolves
      .toMatchInlineSnapshot(`
      "Command failed: pnpm -s dev exec /agent close-session invalid
      Error: Invalid agent session: invalid
      Expected agent:sessionId."
    `);
  });

  test("soft error", async () => {
    const cli = useCli();
    const result = await cli.cli("exec", "/agent default boo");
    expect(sanitizeOutput(result.stderr)).toMatchInlineSnapshot(`""`);
    expect(result.stdout).toMatchInlineSnapshot(`
      "[⚙️ System]
      Unknown agent: boo
      "
    `);
  });
});
