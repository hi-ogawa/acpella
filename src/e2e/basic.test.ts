import { describe, it } from "vitest";
import { startDaemon } from "./helper.ts";

describe("e2e smoke", () => {
  it("starts and responds to /status", async () => {
    const daemon = startDaemon();

    await daemon.waitForLine("Starting daemon");
    daemon.send("/status");
    await daemon.waitForLine("configured agent: codex");

    await daemon.stop();
  });

  it("echo agent round-trip", async () => {
    const daemon = startDaemon({ AGENT: "node src/test-agent.ts" });

    await daemon.waitForLine("Starting daemon");
    daemon.send("hello world");
    await daemon.waitForLine("echo: hello world");

    await daemon.stop();
  });
});
