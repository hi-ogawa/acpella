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
});
