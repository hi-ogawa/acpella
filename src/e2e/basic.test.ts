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
});
