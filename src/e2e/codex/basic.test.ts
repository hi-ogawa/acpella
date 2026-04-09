import path from "node:path";
import { it, vi } from "vitest";
import { ACPX_BIN } from "../../handler.ts";
import { spawnAsync } from "../../spawn.ts";
import { startDaemon } from "../helper.ts";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");
const TEST_CHAT_ID = String(Date.now());

vi.setConfig({
  testTimeout: 30000,
});

it("round-trip with real codex", async ({ onTestFinished }) => {
  const daemon = startDaemon({
    ACPELLA_HOME: FIXTURES_DIR,
    ACPELLA_TEST_CHAT_ID: TEST_CHAT_ID,
  });
  onTestFinished(async () => {
    await daemon.stop();
    // clean up the unique session
    await spawnAsync(ACPX_BIN, [
      "--cwd",
      FIXTURES_DIR,
      "codex",
      "sessions",
      "close",
      `tg-${TEST_CHAT_ID}`,
    ]).catch(() => {});
  });
  await daemon.waitForLine("Starting daemon");
  daemon.send("reply with exactly: pong");
  await daemon.waitForLine("pong");
});
