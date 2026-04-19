/*
Coverage checklist:

- /status
  - [x] output, including default agent
- /service
  - [x] usage output
  - [x] exit calls onServiceExit
- /cancel
  - [ ] with no active turn
  - [ ] active turn success
  - [ ] active turn fallback kill path
- /verbose
  - [x] default status
  - [x] on
  - [x] off
  - [ ] invalid subcommand
  - [x] suppresses tool call output
  - [x] includes tool call output when enabled
  - [ ] is isolated per acpella session
- /session
  - [x] current
  - [x] bare usage output
  - [x] new with default agent
  - [ ] new with named agent
  - [x] new resets agentSessionId before creating a fresh ACP session
  - [x] new sends an empty prompt
  - [x] new unknown agent
  - [x] new agent startup failure
  - [x] load with agent:sessionId
  - [ ] load missing-arg usage
  - [ ] load with plain session id
  - [ ] load unknown agent
  - [ ] load unknown session
  - [x] close explicit agent:sessionId
  - [ ] close with no associated session
  - [ ] close current session
  - [ ] close deletes matching state session
  - [ ] close reports closeSession failure
  - [x] list
  - [ ] list with multiple agents
  - [ ] list marks stored inactive sessions as not active
  - [ ] list tolerates listSessions failure for one agent
- /agent
  - [x] list
  - [x] bare usage output
  - [x] new
  - [ ] new usage when name is missing
  - [ ] new usage when command is missing
  - [ ] new preserves multi-word commands
  - [x] new rejects invalid agent key
  - [x] remove
  - [ ] remove usage when name is missing
  - [ ] remove unknown agent
  - [ ] remove rejects default agent
  - [ ] remove rejects agents referenced by sessions
  - [x] default success
  - [ ] default query form
  - [ ] default unknown agent
  - [ ] default affects later session creation
*/

import fs from "node:fs";
import { expect, test, vi } from "vitest";
import { loadConfig, type AppConfig } from "./config";
import { CronStore } from "./cron/store.ts";
import { createHandler, type HandlerContext } from "./handler";
import { TEST_AGENT_COMMAND } from "./state";
import { useFs } from "./test/helper.ts";

async function createHandlerTester() {
  const { root } = useFs({ prefix: "handler" });
  const config = loadConfig({
    ACPELLA_HOME: root,
  });

  const onServiceExit = vi.fn();
  const handler = await createHandler(config, {
    version: "v1.0.0-test",
    onServiceExit,
    cronStore: new CronStore({
      cronFile: config.cronFile,
      cronStateFile: config.cronStateFile,
    }),
  });

  async function request(context: Omit<HandlerContext, "send">) {
    const messages: string[] = [];
    await handler.handle({
      ...context,
      send: async (t) => messages.push(t),
    });
    return sanitizeOutput(messages.join("\n"), config);
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

function readStateFile(config: AppConfig) {
  const stateFile = config.stateFile;
  if (!fs.existsSync(stateFile)) {
    return null;
  }
  return sanitizeOutput(fs.readFileSync(stateFile, "utf8"), config);
}

test("basic", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");
  expect(await session.request("/help")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Commands:
    /help - Show command help.

    /status
      /status - Show service status.

    /service
      /service exit - Exit acpella.

    /cancel
      /cancel - Cancel the active agent turn.

    /session
      /session current - Show the current session.
      /session list - List known agent sessions.
      /session new [agent] - Start a new agent session.
      /session load <sessionId|agent:sessionId> - Load an existing agent session.
      /session close [sessionId|agent:sessionId] - Close an agent session.

    /agent
      /agent list - List configured agents.
      /agent new <name> <command...> - Save a new agent.
      /agent remove <name> - Remove an agent.
      /agent default [name] - Show or set the default agent.

    /cron
      /cron status - Show cron scheduler status.
      /cron start - Start cron scheduler.
      /cron stop - Stop cron scheduler.
      /cron add <id> <minute> <hour> <day-of-month> <month> <day-of-week> <prompt...> - Add a cron job.
      /cron list - List cron jobs.
      /cron show <id> - Show a cron job.
      /cron enable <id> - Enable a cron job.
      /cron disable <id> - Disable a cron job.
      /cron delete <id> - Delete a cron job.

    /verbose
      /verbose current - Show tool-call output setting.
      /verbose on - Show tool-call updates.
      /verbose off - Hide tool-call updates."
  `);
  expect(await session.request("/status")).toMatchInlineSnapshot(`
    "[⚙️ System]
    status: running
    version: v1.0.0-test
    default agent: test
    home: <home>"
  `);
  expect(await session.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
  expect(readStateFile(tester.config)).toMatchInlineSnapshot(`
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
            "agentSessionId": "__testSession1",
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
    No sessions."
  `);
  expect(await session.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
  expect(await session.request("/session current")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: __testSession1"
  `);
  expect(await session.request("/session list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test -> test:__testSession1 (active)"
  `);
  expect(await session.request("/session new")).toMatchInlineSnapshot(`"echo: (empty)"`);
  expect(await session.request("/session current")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: __testSession2"
  `);
  expect(await session.request("__session")).toMatchInlineSnapshot(`"session: __testSession2"`);
  expect(await session.request("/session list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test -> test:__testSession2 (active)
    - (unknown) -> test:__testSession1 (active)"
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

  expect(await session.request("/verbose current")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Tool call output: off"
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
  expect(await session.request("/verbose current")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Tool call output: off"
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
  await expect(session.request("/session new test-error")).rejects.toMatchInlineSnapshot(
    `[Error: ACP agent failed to start: spawn no-such-command ENOENT]`,
  );
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
  expect(await session.request(`/agent new test2 ${TEST_AGENT_COMMAND}`)).toMatchInlineSnapshot(`
    "[⚙️ System]
    Saved new agent: test2"
  `);
  expect(await session.request("/agent default")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Default agent: test"
  `);
  expect(await session.request("/agent default test2")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Set default agent: test2"
  `);
  expect(await session.request("/agent default")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Default agent: test2"
  `);
  expect(await session.request("/session current")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test-error
    agent session id: none"
  `);
  expect(await session.request("/agent remove test-error")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Cannot remove agent: test-error
    1 session(s) still reference it."
  `);
  expect(await session.request("/session new test2")).toMatchInlineSnapshot(`"echo: (empty)"`);
  expect(await session.request("/session current")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test2
    agent session id: __testSession1"
  `);
  expect(await session.request("/session list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test -> test2:__testSession1 (active)
    - (unknown) -> test:__testSession1 (active)"
  `);
  expect(await session.request("/agent remove test-error")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Removed agent: test-error"
  `);
  expect(readStateFile(tester.config)).toMatchInlineSnapshot(`
    "{
      "version": 2,
      "defaultAgent": "test2",
      "agents": {
        "test": {
          "command": "node <cwd>/src/lib/test-agent.ts"
        },
        "test2": {
          "command": "node <cwd>/src/lib/test-agent.ts"
        }
      },
      "sessions": {
        "test": {
          "agentKey": "test2",
          "agentSessionId": "__testSession1",
          "verbose": false
        }
      }
    }"
  `);
  expect(await session.request("/session load test:__testSession1")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Loaded session: test:__testSession1"
  `);
  expect(await session.request("/session current")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: __testSession1"
  `);
  expect(await session.request("/session close test2:__testSession1")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Session closed: test2:__testSession1."
  `);
  expect(readStateFile(tester.config)).toMatchInlineSnapshot(`
    "{
      "version": 2,
      "defaultAgent": "test2",
      "agents": {
        "test": {
          "command": "node <cwd>/src/lib/test-agent.ts"
        },
        "test2": {
          "command": "node <cwd>/src/lib/test-agent.ts"
        }
      },
      "sessions": {
        "test": {
          "agentKey": "test",
          "agentSessionId": "__testSession1",
          "verbose": false
        }
      }
    }"
  `);
});

test("message metadata", async () => {
  const tester = await createHandlerTester();
  let result = await tester.request({
    sessionName: "test",
    text: `__keep_metadata: ok`,
    metadata: {
      timestamp: Date.UTC(2024, 0, 2, 3, 4, 5),
    },
  });
  result = result
    .replace(/sender_timestamp: .+/, "sender_timestamp: <timestamp>")
    .replace(/timezone: .+/, "timezone: <timezone>");
  expect(result).toMatchInlineSnapshot(`
    "echo: <message_metadata>
    sender_timestamp: <timestamp>
    timezone: <timezone>
    session_name: test
    </message_metadata>
    __keep_metadata: ok"
  `);
});
