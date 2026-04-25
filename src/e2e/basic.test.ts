import { describe, expect, test } from "vitest";
import { sanitizeOutput, startService, useCli } from "./helper.ts";

test("help", async () => {
  const cli = useCli();
  const result = await cli.cli("--help");
  expect(sanitizeOutput(result.stderr)).toMatchInlineSnapshot(`""`);
  expect(result.stdout).toMatchInlineSnapshot(`
    "Usage: acpella [command]

    Commands:
      serve             Run Telegram bot service. Default when no command is provided.
      repl              Run local in-process REPL.
      exec <message...> Run one local message, then exit.

    Options:
      -h, --help        Show this help.

    "
  `);
});

function sanitizeCliError(error: Error) {
  return sanitizeOutput(error.message)
    .replaceAll(/    at .*\n/g, "")
    .trim();
}

test("cli error", async () => {
  const cli = useCli();
  await expect(cli.cli("yay").catch(sanitizeCliError)).resolves.toThrowErrorMatchingInlineSnapshot(`
    "Command failed: pnpm -s cli yay
    Error: Unknown command: yay"
  `);
});

describe("repl", () => {
  test("basic", async () => {
    const service = startService();
    await service.waitForOutput("Starting repl");
    service.write("/status");
    await service.waitForOutput("status: running");
    service.write("hello world");
    await service.waitForOutput("echo: hello world");
  });

  test("does not pass ACPELLA env to the agent", async () => {
    const service = startService({
      env: {
        ACPELLA_TELEGRAM_BOT_TOKEN: "secret-token",
        AGENT_VISIBLE_KEY: "agent-visible-key",
      },
    });
    await service.waitForOutput("Starting repl");
    service.write("__env:ACPELLA_TELEGRAM_BOT_TOKEN");
    await service.waitForOutput("env: ACPELLA_TELEGRAM_BOT_TOKEN=(unset)");
    service.write("__env:AGENT_VISIBLE_KEY");
    await service.waitForOutput("env: AGENT_VISIBLE_KEY=agent-visible-key");
  });
});

describe("exec", async () => {
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
    await expect(cli.cli("exec", "/session load error-agent:error-session").catch(sanitizeCliError))
      .resolves.toMatchInlineSnapshot(`
      "Command failed: pnpm -s cli exec /session load error-agent:error-session
      Error: Unknown agent: error-agent"
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
