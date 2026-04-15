import path from "node:path";
import { it, vi } from "vitest";
import { startService } from "../helper.ts";

vi.setConfig({
  testTimeout: 30000,
});

it("basic", async () => {
  const service = startService({}, { sourceDir: path.join(import.meta.dirname, "fixtures/basic") });
  await service.waitForOutput("Starting service");
  service.write("/agent new codex codex-acp");
  await service.waitForOutput("Saved new agent: codex");
  service.write("/agent default codex");
  await service.waitForOutput("Set default agent: codex");

  service.write("hello");
  await service.waitForOutput("world");
});

it("uses custom prompt file", async () => {
  const service = startService(
    {},
    { sourceDir: path.join(import.meta.dirname, "fixtures/custom-prompt") },
  );
  await service.waitForOutput("Starting service");
  service.write("/agent new codex codex-acp");
  await service.waitForOutput("Saved new agent: codex");
  service.write("/agent default codex");
  await service.waitForOutput("Set default agent: codex");

  service.write("ping-custom-prompt");
  await service.waitForOutput("pong-custom-prompt");
});
