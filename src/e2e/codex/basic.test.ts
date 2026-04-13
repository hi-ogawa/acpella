import path from "node:path";
import { it, vi } from "vitest";
import { startService } from "../helper.ts";

vi.setConfig({
  testTimeout: 30000,
});

it("basic", async ({ onTestFinished }) => {
  const service = startService(
    {
      ACPELLA_AGENT: "codex-acp",
    },
    { sourceDir: path.join(import.meta.dirname, "fixtures/basic") },
  );
  onTestFinished(async () => {
    await service.stop();
  });
  await service.waitForLine("Starting service");
  service.write("hello");
  await service.waitForLine("world");
});

it("uses custom prompt file", async ({ onTestFinished }) => {
  const service = startService(
    {
      ACPELLA_AGENT: "codex-acp",
    },
    { sourceDir: path.join(import.meta.dirname, "fixtures/custom-prompt") },
  );
  onTestFinished(async () => {
    await service.stop();
  });
  await service.waitForLine("Starting service");
  service.write("ping-custom-prompt");
  await service.waitForLine("pong-custom-prompt");
});
