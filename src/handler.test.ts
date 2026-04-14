import fs from "node:fs";
import path from "node:path";
import { describe, expect, onTestFinished, test } from "vitest";
import { loadConfig } from "./config";
import { createHandler } from "./handler";

async function createTestHandler() {
  const home = path.join(import.meta.dirname, `../.tmp/test-handler-${crypto.randomUUID()}`);
  fs.mkdirSync(home, { recursive: true });
  onTestFinished(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });
  const config = loadConfig({
    ACPELLA_HOME: home,
  });
  return createHandler(config, {
    onServiceExit: () => {},
  });
}

describe(createHandler, () => {
  test("basic", async () => {
    const handler = await createTestHandler();
    // TODO: create grammy Context or define minimal HandlerContext
    const messages: string[] = [];
    const context = {
      message: {
        text: "/session",
      },
      async reply(text: string): Promise<void> {
        messages.push(text);
      },
    } as any;
    await handler.handle({ session: "test-session", context });
    expect(messages).toMatchInlineSnapshot(`
      [
        "[⚙️ System]
      session: test-session
      agent: test
      session id: none",
      ]
    `);
  });
});
