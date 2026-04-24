import path from "node:path";
import { describe, expect, test } from "vitest";
import { useFs } from "../test/helper.ts";
import { execFileAsync, startService } from "./helper.ts";

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

test("cli exec", async () => {
  const { root } = useFs({
    prefix: "e2e-exec",
  });

  const result = await execFileAsync("pnpm", ["-s", "cli", "exec", "/service"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env,
      ACPELLA_HOME: root,
    },
  });
  expect(result.stdout).toMatchInlineSnapshot(`
    "[⚙️ System]
    /service
      /service exit - Exit acpella.
    "
  `);
});
