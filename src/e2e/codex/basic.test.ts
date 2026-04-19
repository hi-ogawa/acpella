import { it, vi } from "vitest";
import { startService, type TestService } from "../helper.ts";

vi.setConfig({
  testTimeout: 20000,
});

const CODEX_CONFIG = ["model=gpt-5.2", "model_reasoning_effort=low", "features.codex_hooks=false"];
const CODEX_ARGS = CODEX_CONFIG.map((s) => `-c ${s}`).join(" ");

async function setupService(service: TestService) {
  await service.waitForOutput("Starting repl");
  service.write(`/agent new codex codex-acp ${CODEX_ARGS}`);
  await service.waitForOutput("Saved new agent: codex");
  service.write("/agent default codex");
  await service.waitForOutput("Set default agent: codex");
}

it("basic", async () => {
  const service = startService({ sourceDir: "./fixtures/basic" });
  await setupService(service);
  service.write("hello");
  await service.waitForOutput("olleh");
});

it("uses custom prompt file", async () => {
  const service = startService({
    sourceDir: "./fixtures/custom-prompt",
  });
  await setupService(service);
  service.write("ping-custom-prompt");
  await service.waitForOutput("prompt-pong-custom");
});
