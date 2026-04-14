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

  async function request({ sessionName, text }: { sessionName: string; text: string }) {
    const replies: string[] = [];
    const context: HandlerContext = {
      message: {
        text,
      },
      async reply(text: string) {
        replies.push(text);
      },
    };
    await handler.handle({ sessionName, context });
    return replies.join("\n");
  }

  function createSession(sessionName: string) {
    return {
      request: (text: string) => request({ sessionName, text }),
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
    const result = await tester.request({ sessionName: "test", text: "hello" });
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

  test("verbose command toggles tool call output", async () => {
    const tester = await createHandlerTester();
    const session = tester.createSession("test");

    expect(await session.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
    expect(await session.request("/verbose")).toMatchInlineSnapshot(`
      "[⚙️ System]
      Tool call output: off
      Usage: /verbose [on|off]"
    `);
    expect(await session.request("__tool:Read files")).toMatchInlineSnapshot(
      `"echo: __tool:Read files"`,
    );
    expect(await session.request("/verbose off")).toMatchInlineSnapshot(`
      "[⚙️ System]
      Tool call output: off"
    `);
    expect(await session.request("__tool:Search docs")).toMatchInlineSnapshot(
      `"echo: __tool:Search docs"`,
    );
    expect(await session.request("__chunk_tool:Search docs")).toMatchInlineSnapshot(`
      "before
      after"
    `);
    expect(await session.request("/verbose")).toMatchInlineSnapshot(`
      "[⚙️ System]
      Tool call output: off
      Usage: /verbose [on|off]"
    `);
    expect(await session.request("/verbose on")).toMatchInlineSnapshot(`
      "[⚙️ System]
      Tool call output: on"
    `);
    expect(await session.request("__tool:Edit file")).toMatchInlineSnapshot(`
      "Tool: Edit file
      echo: __tool:Edit file"
    `);
  });
});
