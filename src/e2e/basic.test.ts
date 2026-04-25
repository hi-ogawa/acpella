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

test("cli error", async () => {
  const cli = useCli();
  await expect(cli.cli("yay")).rejects.toThrowErrorMatchingInlineSnapshot(`
    [Error: Command failed: pnpm -s cli blabla
    Error: Unknown command: blabla
        at parseCli (file:///home/hiroshi/code/personal/acpella/src/lib/cli.ts:17:11)
        at main (file:///home/hiroshi/code/personal/acpella/src/cli.ts:40:15)
        at file:///home/hiroshi/code/personal/acpella/src/cli.ts:355:1
        at ModuleJob.run (node:internal/modules/esm/module_job:430:25)
        at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:661:26)
        at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)
    ]
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
    await expect(cli.cli("exec", "/session load error-agent:error-session")).rejects.toSatisfy(
      (e) => {
        expect.assert(e instanceof Error);
        expect(sanitizeOutput(e.message).split("\n").slice(0, 2)).toMatchInlineSnapshot(`
        [
          "Command failed: pnpm -s cli exec /session load error-agent:error-session",
          "Error: Unknown agent: error-agent",
        ]
      `);
        return true;
      },
    );
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
