import path from "node:path";
import { describe, it } from "vitest";
import { startService } from "./helper.ts";

describe("e2e smoke", () => {
  it("starts and responds to /status", async () => {
    const service = startService();
    await service.waitForOutput("Starting service");
    service.write("/status");
    await service.waitForOutput("configured agent: test");
  });

  it("echo agent round-trip", async () => {
    const service = startService();
    await service.waitForOutput("Starting service");
    service.write("hello world");
    await service.waitForOutput("echo: hello world");
  });

  it("reports agent startup failure", async () => {
    const service = startService({ ACPELLA_AGENT: "no-such-command" });
    await service.waitForOutput("Starting service");
    service.write("hello world");
    await service.waitForOutput("Error: ACP agent failed to start: spawn no-such-command ENOENT");
  });

  it("does not pass ACPELLA env to the agent", async () => {
    const service = startService({
      ACPELLA_AGENT: `${process.execPath} ${path.join(import.meta.dirname, "../lib/test-agent.ts")}`,
      ACPELLA_TELEGRAM_BOT_TOKEN: "secret-token",
      OPENAI_API_KEY: "agent-key",
    });
    await service.waitForOutput("Starting service");
    service.write("__env:ACPELLA_TELEGRAM_BOT_TOKEN");
    await service.waitForOutput("(unset)");
    service.write("__env:OPENAI_API_KEY");
    await service.waitForOutput("agent-key");
  });
});
