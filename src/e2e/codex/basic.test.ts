import fs from "node:fs";
import path from "node:path";
import { it, vi } from "vitest";
import { startService } from "../helper.ts";

vi.setConfig({
  testTimeout: 30000,
});

it("basic", async ({ onTestFinished }) => {
  const service = startService({
    ACPELLA_AGENT: "codex",
  });
  onTestFinished(async () => {
    await service.stop();
  });
  fs.cpSync(
    path.join(import.meta.dirname, "fixtures/basic/AGENTS.md"),
    path.join(service.home, "AGENTS.md"),
  );
  await service.waitForLine("Starting service");
  service.send("hello");
  await service.waitForLine("world");
});
