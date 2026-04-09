import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, it } from "vitest";
import { startDaemon } from "../helper.ts";

const ACPX_BIN = fileURLToPath(new URL("../../../node_modules/.bin/acpx", import.meta.url));
const FIXTURES_DIR = import.meta.dirname + "/fixtures";

function acpxCloseSession() {
  try {
    execFileSync(ACPX_BIN, ["--cwd", FIXTURES_DIR, "codex", "sessions", "close", "tg-123"], {
      timeout: 30_000,
    });
  } catch {
    // ignore — session may not exist
  }
}

beforeAll(async () => {
  acpxCloseSession();
  return () => {
    acpxCloseSession();
  };
});

it("round-trip with real codex", async ({ onTestFinished }) => {
  const daemon = startDaemon({ ACPELLA_HOME: FIXTURES_DIR });
  onTestFinished(() => daemon.stop());
  await daemon.waitForLine("Starting daemon");
  daemon.send("reply with exactly: pong");
  await daemon.waitForLine("pong", 120_000);
}, 120_000);
