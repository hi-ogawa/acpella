/*
Coverage checklist:

- [ ] /status output, including default agent
- [ ] /service usage output
- [ ] /service exit calls onServiceExit
- [ ] /cancel with no active turn
- [ ] /cancel active turn success
- [ ] /cancel active turn fallback kill path
- [ ] /verbose default status
- [ ] /verbose on
- [ ] /verbose off
- [ ] /verbose invalid subcommand
- [ ] /verbose suppresses tool call output
- [ ] /verbose includes tool call output when enabled
- [ ] /verbose is isolated per acpella session
- [ ] /session current
- [ ] /session bare usage output
- [ ] /session new with default agent
- [ ] /session new with named agent
- [ ] /session new resets agentSessionId before creating a fresh ACP session
- [ ] /session new sends an empty prompt
- [ ] /session new unknown agent
- [ ] /session new agent startup failure
- [ ] /session load missing-arg usage
- [ ] /session load with plain session id
- [ ] /session load with agent:sessionId
- [ ] /session load unknown agent
- [ ] /session load unknown session
- [ ] /session close with no associated session
- [ ] /session close current session
- [ ] /session close explicit agent:sessionId
- [ ] /session close deletes matching state session
- [ ] /session close reports closeSession failure
- [ ] /session list with multiple agents
- [ ] /session list marks stored inactive sessions as not active
- [ ] /session list tolerates listSessions failure for one agent
- [ ] /agent list
- [ ] /agent bare usage output
- [ ] /agent new usage when name is missing
- [ ] /agent new usage when command is missing
- [ ] /agent new preserves multi-word commands
- [ ] /agent new rejects invalid agent key
- [ ] /agent remove usage when name is missing
- [ ] /agent remove unknown agent
- [ ] /agent remove rejects default agent
- [ ] /agent remove rejects agents referenced by sessions
- [ ] /agent remove success
- [ ] /agent default query form
- [ ] /agent default unknown agent
- [ ] /agent default success
- [ ] /agent default affects later session creation
*/

import fs from "node:fs";
import path from "node:path";
import { expect, onTestFinished, test, vi } from "vitest";
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

  const onServiceExit = vi.fn();
  const handler = await createHandler(config, {
    version: "v1.0.0-test",
    onServiceExit,
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
    onServiceExit,
  };
}

function sanitizeOutput(output: string, config: AppConfig) {
  return output.replaceAll(config.home, () => "<home>").replaceAll(process.cwd(), () => "<cwd>");
}

test("basic", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");
  expect(await session.request("/status")).toMatchInlineSnapshot(`
    "[⚙️ System]
    status: running
    version: v1.0.0-test
    default agent: test
    home: <home>"
  `);
  expect(await session.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
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
            "agentSessionId": "__testLoadSession",
            "verbose": false
          }
        }
      }"
    `);
});

test("service commands", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");
  expect(await session.request("/service")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Usage: /service exit"
  `);
  await session.request("/service exit");
  expect(tester.onServiceExit.mock.calls).toMatchInlineSnapshot(`
    [
      [],
    ]
  `);
});

test("session commands", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");
  expect(await session.request("/session")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Usage:
    /session current
    /session list
    /session new [agent]
    /session load <sessionId|agent:sessionId>
    /session close [sessionId|agent:sessionId]"
  `);
  expect(await session.request("/session current")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: none"
  `);
  expect(await session.request("/session list")).toMatchInlineSnapshot(`
      "[⚙️ System]
      - (unknown) -> test:__testLoadSession (active)
      - (unknown) -> test:other-session (active)"
    `);
  expect(await session.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
  expect(await session.request("/session current")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: __testLoadSession"
  `);
  expect(await session.request("/session list")).toMatchInlineSnapshot(`
      "[⚙️ System]
      - test -> test:__testLoadSession (active)
      - (unknown) -> test:other-session (active)"
    `);
  expect(await session.request("/session new no-such-agent")).toMatchInlineSnapshot(
    `
    "[⚙️ System]
    Unknown agent: no-such-agent"
  `,
  );
});

test("verbose command toggles tool call output", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

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
  expect(await session.request("/agent new test-error no-such-command")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Saved new agent: test-error"
  `);
  await expect(session.request("/agent new bad:key no-such-command")).rejects
    .toMatchInlineSnapshot(`
    [ZodError: [
      {
        "code": "invalid_key",
        "origin": "record",
        "issues": [
          {
            "origin": "string",
            "code": "invalid_format",
            "format": "regex",
            "pattern": "/^[a-zA-Z0-9_-]+$/",
            "path": [],
            "message": "Invalid string: must match pattern /^[a-zA-Z0-9_-]+$/"
          }
        ],
        "path": [
          "agents",
          "bad:key"
        ],
        "message": "Invalid key in record"
      }
    ]]
  `);
  expect(await session.request("/agent list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test -> node <cwd>/src/lib/test-agent.ts (default)
    - test-error -> no-such-command"
  `);
  await expect(session.request("/session new test-error")).rejects.toMatchInlineSnapshot(
    `[Error: ACP agent failed to start: spawn no-such-command ENOENT]`,
  );
  expect(await session.request("/agent default test-error")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Set default agent: test-error"
  `);
});
