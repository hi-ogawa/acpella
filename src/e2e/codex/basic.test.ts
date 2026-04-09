import { fileURLToPath } from "node:url";
import { beforeAll, it } from "vitest";
import { spawnAsync } from "../../spawn.ts";
import { startDaemon } from "../helper.ts";

const ACPX_BIN = fileURLToPath(new URL("../../../node_modules/.bin/acpx", import.meta.url));
const FIXTURES_DIR = import.meta.dirname + "/fixtures";

async function acpxCloseSession() {
  try {
    await spawnAsync(ACPX_BIN, ["--cwd", FIXTURES_DIR, "codex", "sessions", "close", "tg-123"], {
      timeout: 30_000,
    });
  } catch {
    // ignore — session may not exist
  }
}

beforeAll(async () => {
  await acpxCloseSession();
  return async () => {
    await acpxCloseSession();
  };
});

it("round-trip with real codex", async ({ onTestFinished }) => {
  const daemon = startDaemon({ ACPELLA_HOME: FIXTURES_DIR });
  onTestFinished(() => daemon.stop());
  await daemon.waitForLine("Starting daemon");
  daemon.send("reply with exactly: pong");
  await daemon.waitForLine("pong", 120_000);
}, 120_000);
