import { describe, it } from "vitest";
import { startService } from "./helper.ts";

describe("basic", () => {
  it("starts and responds to /status", async () => {
    const service = startService();
    await service.waitForOutput("Starting service");
    service.write("/status");
    await service.waitForOutput("status: running");
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
      ACPELLA_TELEGRAM_BOT_TOKEN: "secret-token",
      AGENT_VISIBLE_KEY: "agent-visible-key",
    });
    await service.waitForOutput("Starting service");
    service.write("__env:ACPELLA_TELEGRAM_BOT_TOKEN");
    await service.waitForOutput("env: ACPELLA_TELEGRAM_BOT_TOKEN=(unset)");
    service.write("__env:AGENT_VISIBLE_KEY");
    await service.waitForOutput("env: AGENT_VISIBLE_KEY=agent-visible-key");
  });
});
