import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, it, vi } from "vitest";
import { spawnAsync } from "../../spawn.ts";
import { startService } from "../helper.ts";

const ACPX_BIN = fileURLToPath(new URL("../../../../node_modules/.bin/acpx", import.meta.url));
const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");
const TEST_CHAT_ID = `10101010`;

vi.setConfig({
  testTimeout: 30000,
});

async function closeSession() {
  await spawnAsync(ACPX_BIN, [
    "--cwd",
    FIXTURES_DIR,
    "codex",
    "sessions",
    "close",
    `tg-${TEST_CHAT_ID}`,
  ]);
}

beforeAll(async () => {
  try {
    await closeSession();
  } catch (e) {
    if (!(e instanceof Error && e.message.includes("No named session"))) {
      throw e;
    }
  }
  return () => closeSession();
});

it("round-trip with real codex", async ({ onTestFinished }) => {
  const service = startService({
    ACPELLA_HOME: FIXTURES_DIR,
    ACPELLA_TEST_CHAT_ID: TEST_CHAT_ID,
  });
  onTestFinished(async () => {
    await service.stop();
  });
  await service.waitForLine("Starting service");
  service.send("reply with exactly: pong");
  await service.waitForLine("pong");
});
