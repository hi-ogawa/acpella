import fs from "node:fs";
import path from "node:path";
import { describe, expect, onTestFinished, test } from "vitest";
import { loadConfig, type AppConfig } from "./config";
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
    return sanitizeOutput(replies.join("\n"), config);
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

function sanitizeOutput(output: string, config: AppConfig) {
  return output.replaceAll(config.home, () => "<home>").replaceAll(process.cwd(), () => "<cwd>");
}

describe(createHandler, () => {
  test("basic", async () => {
    const tester = await createHandlerTester();
    const result = await tester.request({ sessionName: "test", text: "hello" });
    expect(result).toMatchInlineSnapshot(`"echo: hello"`);
    const state = fs.readFileSync(tester.config.stateFile, "utf8");
    expect(sanitizeOutput(state, tester.config)).toMatchInlineSnapshot(`
      "{
        "version": 2,
        "defaultAgent": "test",
        "agents": {
          "test": {
            "command": "node <cwd>/src/lib/test-agent.ts"
          }
        },
        "sessions": {
          "test": {
            "agentKey": "test",
            "agentSessionId": "__testLoadSession"
          }
        }
      }"
    `);
  });

  test("session commands", async () => {
    const tester = await createHandlerTester();
    const session = tester.createSession("test");
    expect(await session.request("/session list")).toMatchInlineSnapshot(`
      "[⚙️ System]
      - (unknown) -> test:__testLoadSession (active)
      - (unknown) -> test:other-session (active)"
    `);
    expect(await session.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
    expect(await session.request("/session list")).toMatchInlineSnapshot(`
      "[⚙️ System]
      - test -> test:__testLoadSession (active)
      - (unknown) -> test:other-session (active)"
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
    expect(await session.request("/verbose on")).toMatchInlineSnapshot(`
      "[⚙️ System]
      Tool call output: on"
    `);
    expect(await session.request("__tool:Read files")).toMatchInlineSnapshot(`
      "Tool: Read files
      echo: __tool:Read files"
    `);
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

test("agent command", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");
  expect(await session.request("/agent")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Usage:
    /agent list
    /agent new <name> <command...>
    /agent remove <name>
    /agent default [name]"
  `);
  expect(await session.request("/agent list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test -> node <cwd>/src/lib/test-agent.ts (default)"
  `);
});
