import { it } from "vitest";
import { startDaemon } from "../helper.ts";

it("round-trip with real codex", async () => {
  const daemon = startDaemon();

  await daemon.waitForLine("Starting daemon");
  daemon.send("reply with exactly: pong");
  await daemon.waitForLine("pong", 120_000);

  await daemon.stop();
});
