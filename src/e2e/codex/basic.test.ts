import { it, vi } from "vitest";
import { startService, type TestService } from "../helper.ts";

vi.setConfig({
  testTimeout: 15000,
});

async function setupService(service: TestService) {
  await service.waitForOutput("Starting repl");
  service.write("/agent new codex codex-acp");
  await service.waitForOutput("Saved new agent: codex");
  service.write("/agent default codex");
  await service.waitForOutput("Set default agent: codex");
}

it("basic", async () => {
  const service = startService({ sourceDir: "./fixtures/basic" });
  await setupService(service);
  service.write("hello");
  await service.waitForOutput("world");
});

it("uses custom prompt file", async () => {
  const service = startService({
    sourceDir: "./fixtures/custom-prompt",
  });
  await setupService(service);
  service.write("ping-custom-prompt");
  await service.waitForOutput("prompt-pong-custom");
});
