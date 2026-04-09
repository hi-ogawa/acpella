import { beforeAll, it, vi } from "vitest";
import { spawnAsync } from "../../spawn.ts";
import { startDaemon } from "../helper.ts";
import { ACPX_BIN } from "../../handler.ts";
import path from "node:path";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

async function acpxCloseSession() {
  await spawnAsync(ACPX_BIN, ["--cwd", FIXTURES_DIR, "codex", "sessions", "close", "tg-123"]);
}

beforeAll(async () => {
  await acpxCloseSession();
  return async () => {
    await acpxCloseSession();
  };
});

vi.setConfig({
  testTimeout: 30000,
});

it("round-trip with real codex", async ({ onTestFinished }) => {
  const daemon = startDaemon({ ACPELLA_HOME: FIXTURES_DIR });
  onTestFinished(() => daemon.stop());
  await daemon.waitForLine("Starting daemon");
  daemon.send("reply with exactly: pong");
  await daemon.waitForLine("pong");
});
