import { afterAll, beforeAll, it } from "vitest";
import { startDaemon } from "../helper.ts";

const FIXTURES_DIR = import.meta.dirname + "/fixtures";

const daemon = startDaemon({ ACPELLA_HOME: FIXTURES_DIR });

beforeAll(async () => {
  await daemon.waitForLine("Starting daemon");
});

afterAll(async () => {
  // close the session so tests don't leave stale sessions on the fixture dir
  daemon.send("/reset");
  await daemon.waitForLine("Session reset", 30_000);
  await daemon.stop();
});

it("round-trip with real codex", async () => {
  daemon.send("reply with exactly: pong");
  await daemon.waitForLine("pong", 120_000);
}, 120_000);
