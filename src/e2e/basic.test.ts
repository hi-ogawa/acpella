import { describe, it } from "vitest";
import { startService } from "./helper.ts";

describe("e2e smoke", () => {
  it("starts and responds to /status", async ({ onTestFinished }) => {
    const service = startService();
    onTestFinished(async () => {
      await service.stop();
    });

    await service.waitForLine("Starting service");
    service.send("/status");
    await service.waitForLine("configured agent: test");
  });

  it("echo agent round-trip", async ({ onTestFinished }) => {
    const service = startService();
    onTestFinished(async () => {
      await service.stop();
    });

    await service.waitForLine("Starting service");
    service.send("hello world");
    await service.waitForLine("echo: hello world");
  });
});
