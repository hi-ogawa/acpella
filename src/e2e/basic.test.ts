import { describe, it } from "vitest";
import { startService } from "./helper.ts";

describe("e2e smoke", () => {
  it("starts and responds to /status", async () => {
    const service = startService();

    await service.waitForLine("Starting service");
    service.send("/status");
    await service.waitForLine("configured agent: codex");

    await service.stop();
  });

  it("echo agent round-trip", async () => {
    const service = startService({ ACPELLA_AGENT: "node src/test-agent.ts" });

    await service.waitForLine("Starting service");
    service.send("hello world");
    await service.waitForLine("echo: hello world");

    await service.stop();
  });
});
