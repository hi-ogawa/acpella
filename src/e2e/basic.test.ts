import path from "node:path";
import { describe, expect, test } from "vitest";
import { useFs } from "../test/helper.ts";
import { execFileAsync, sanitizeOutput, startService } from "./helper.ts";

describe("basic", () => {
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

function useCli() {
  const { root } = useFs({
    prefix: "e2e-exec",
  });
  function exec(message: string) {
    return execFileAsync("pnpm", ["-s", "cli", "exec", message], {
      cwd: path.join(import.meta.dirname, "../.."),
      env: {
        ...process.env,
        ACPELLA_HOME: root,
      },
    });
  }
  return { root, exec };
}

describe("exec", async () => {
  test("command", async () => {
    const cli = useCli();
    const result = await cli.exec("/service");
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
    const result = await cli.exec("__multiple_chunks:hello");
    expect(sanitizeOutput(result.stderr)).toMatchInlineSnapshot(`""`);
    expect(result.stdout).toMatchInlineSnapshot(`
      "echo-1: helloecho-2: hello
      "
    `);
  });
});
