import path from "node:path";
import { it, vi } from "vitest";
import { startService } from "../helper.ts";

vi.setConfig({
  testTimeout: 30000,
});

it("basic", async () => {
  const service = startService(
    {
      ACPELLA_AGENT: "codex-acp",
    },
    { sourceDir: path.join(import.meta.dirname, "fixtures/basic") },
  );
  await service.waitForOutput("Starting service");
  service.write("hello");
  await service.waitForOutput("world");
});

it("uses custom prompt file", async () => {
  const service = startService(
    {
      ACPELLA_AGENT: "codex-acp",
    },
    { sourceDir: path.join(import.meta.dirname, "fixtures/custom-prompt") },
  );
  await service.waitForOutput("Starting service");
  service.write("ping-custom-prompt");
  await service.waitForOutput("pong-custom-prompt");
});
