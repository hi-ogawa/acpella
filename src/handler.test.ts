import fs from "node:fs";
import path from "node:path";
import { describe, expect, onTestFinished, test } from "vitest";
import { loadConfig } from "./config";
import { createHandler, type HandlerContext } from "./handler";

async function createHandlerTester() {
  const home = path.join(import.meta.dirname, `../.tmp/test-handler-${crypto.randomUUID()}`);
  fs.mkdirSync(home, { recursive: true });
  onTestFinished(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  const config = loadConfig({
    ACPELLA_HOME: home,
  });

  const handler = await createHandler(config, {
    onServiceExit: () => {},
  });

  async function request({ session, text }: { session: string; text: string }) {
    const replies: string[] = [];
    const context: HandlerContext = {
      message: {
        text,
      },
      async reply(text: string) {
        replies.push(text);
      },
    };
    await handler.handle({ session, context });
    return replies.join("\n");
  }

  function createSession(session: string) {
    return {
      request: (text: string) => request({ session, text }),
    };
  }

  return {
    config,
    request,
    createSession,
  };
}

describe(createHandler, () => {
  test("basic", async () => {
    const tester = await createHandlerTester();
    const result = await tester.request({ session: "test", text: "hello" });
    expect(result).toMatchInlineSnapshot(`"echo: hello"`);
    expect(fs.existsSync(tester.config.stateFile)).toBe(true);
  });

  test("session commands", async () => {
    const tester = await createHandlerTester();
    const session = tester.createSession("test");
    expect(await session.request("/session list")).toMatchInlineSnapshot(`
      "[⚙️ System]
      - (unknown) -> __testLoadSession (active)
      - (unknown) -> other-session (active)"
    `);
    expect(await session.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
    expect(await session.request("/session list")).toMatchInlineSnapshot(`
      "[⚙️ System]
      - test -> __testLoadSession (active)
      - (unknown) -> other-session (active)"
    `);
  });
});
