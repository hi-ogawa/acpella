/*
Coverage checklist:

- /status
  - [x] output, including default agent
- /service
  - [x] usage output
  - [x] exit calls onServiceExit
- /cancel
  - [x] with no active turn
  - [x] active turn success
  - [ ] active turn fallback kill path
- /session
  - [x] info
  - [x] info includes verbose status
  - [x] new with default agent
  - [ ] new with named agent
  - [x] new resets agentSessionId before creating a fresh ACP session
  - [x] new waits for next prompt before ACP session bootstrap
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
  - [x] verbose on
  - [x] verbose off
  - [x] verbose suppresses tool call output
  - [x] verbose includes tool call output when enabled
  - [ ] verbose is isolated per acpella session
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
- /cron
  - [x] bare help output
  - [x] status
  - [x] start
  - [x] stop
  - [x] reload
  - [x] add
  - [ ] add rejects missing delivery target
  - [ ] add rejects invalid args
  - [ ] add rejects invalid id
  - [ ] add rejects invalid schedule
  - [ ] add refreshes runner
  - [x] list
  - [x] show
  - [ ] show unknown id
  - [x] enable
  - [ ] enable unknown id
  - [x] disable
  - [ ] disable unknown id
  - [x] delete
  - [ ] delete unknown id
  - [x] runner executes repl cron job through handler prompt
  - [ ] runner records failed delivery
*/

import fs from "node:fs";
import { expect, test, vi } from "vitest";
import { loadConfig, type AppConfig } from "./config";
import { CronRunner } from "./cron/runner.ts";
import { CronStore } from "./cron/store.ts";
import { createHandler, type HandlerContext } from "./handler";
import { writeJsonFile } from "./lib/utils-node.ts";
import { formatTime } from "./lib/utils.ts";
import { TEST_AGENT_COMMAND } from "./state";
import { useFs } from "./test/helper.ts";

async function createHandlerTester() {
  const { root } = useFs({ prefix: "handler" });
  const config = loadConfig({
    ACPELLA_HOME: root,
    TEST_ACPELLA_TIMEZONE: "Asia/Jakarta",
  });

  const cronStore = new CronStore({
    cronFile: config.cronFile,
    cronStateFile: config.cronStateFile,
  });
  const cronDeliveries: string[] = [];
  const cronRunner = new CronRunner({
    store: cronStore,
    agent: {
      prompt: (options) => handler.prompt(options),
    },
    delivery: {
      send: async ({ text }) => {
        cronDeliveries.push(text);
      },
    },
  });

  const onServiceExit = vi.fn();
  const handler = await createHandler(config, {
    version: "v1.0.0-test",
    onServiceExit,
    cronStore,
    getCronRunner: () => cronRunner,
  });

  async function request(context: Omit<HandlerContext, "send">) {
    const replies: string[] = [];
    await handler.handle({
      ...context,
      send: async (t) => replies.push(t),
    });
    return sanitizeOutput(replies.join("\n"), config);
  }

  function requestStream(context: Omit<HandlerContext, "send">) {
    const replies: string[] = [];
    const promise = handler.handle({
      ...context,
      send: async (t) => replies.push(sanitizeOutput(t, config)),
    });
    return {
      promise,
      replies,
    };
  }

  function createSession(sessionName: string, context?: Partial<HandlerContext>) {
    return {
      request: (text: string) => request({ ...context, sessionName, text }),
      requestStream: (text: string) => requestStream({ ...context, sessionName, text }),
    };
  }

  return {
    config,
    request,
    requestStream,
    createSession,
    onServiceExit,
    cronStore,
    cronRunner,
    cronDeliveries,
  };
}

function sanitizeOutput(output: string, config: AppConfig) {
  return output
    .replaceAll(config.home, () => "<home>")
    .replaceAll(process.cwd(), () => "<cwd>")
    .replaceAll(/"t":(\d+|"[^"]+")/g, `"t":"<time>"`)
    .replaceAll(/"updatedAt": \d+/g, `"updatedAt": <time>`);
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
      /service systemd install - Install systemd service.
      /service exit - Exit acpella.

    /cancel
      /cancel - Cancel the active agent turn.

    /session
      /session info [sessionName] - Show info about a session.
      /session list - List known agent sessions.
      /session new [agent] - Start a new agent session.
      /session load <sessionId|agent:sessionId> - Load an existing agent session.
      /session close [sessionId|agent:sessionId] - Close an agent session.
      /session verbose on [sessionName] - Enable tool-call output.
      /session verbose off [sessionName] - Disable tool-call output.

    /agent
      /agent list - List configured agents.
      /agent new <name> <command...> - Save a new agent.
      /agent remove <name> - Remove an agent.
      /agent default [name] - Show or set the default agent.

    /cron
      /cron status - Show cron scheduler status.
      /cron start - Start cron scheduler.
      /cron stop - Stop cron scheduler.
      /cron reload - Reload cron jobs from disk.
      /cron add <id> <minute> <hour> <day-of-month> <month> <day-of-week> [--session <sessionName>] -- <prompt...> - Add a cron job.
      /cron list - List cron jobs.
      /cron show <id> - Show a cron job.
      /cron enable <id> - Enable a cron job.
      /cron disable <id> - Disable a cron job.
      /cron delete <id> - Delete a cron job."
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
        },
        "agentSessions": {}
      }"
    `);
});

test("agent error", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");
  await expect(session.request("__throw_error__")).rejects.toMatchInlineSnapshot(
    `[RequestError: Internal error]`,
  );
});

test("logs", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");
  const logFile = `${tester.config.logsDir}/acp/test/__testSession1.jsonl`;
  function readLogs() {
    if (!fs.existsSync(logFile)) {
      return null;
    }
    return "\n" + sanitizeOutput(fs.readFileSync(logFile, "utf8"), tester.config);
  }
  expect(readLogs()).toMatchInlineSnapshot(`null`);
  await session.request("__multiple_chunks:hello");
  expect(readLogs()).toMatchInlineSnapshot(`
    "
    {"t":"<time>","type":"prompt","text":"__multiple_chunks:hello"}
    {"t":"<time>","type":"update:agent_message_chunk:text","batch":[{"t":"<time>","text":"echo-1: hello"},{"t":"<time>","text":"echo-2: hello"}]}
    {"t":"<time>","type":"done","cancelled":false}
    "
  `);
  await session.request("__chunk_tool:Search docs");
  expect(readLogs()).toMatchInlineSnapshot(`
    "
    {"t":"<time>","type":"prompt","text":"__multiple_chunks:hello"}
    {"t":"<time>","type":"update:agent_message_chunk:text","batch":[{"t":"<time>","text":"echo-1: hello"},{"t":"<time>","text":"echo-2: hello"}]}
    {"t":"<time>","type":"done","cancelled":false}
    {"t":"<time>","type":"prompt","text":"__chunk_tool:Search docs"}
    {"t":"<time>","type":"update:agent_message_chunk:text","text":"before"}
    {"t":"<time>","type":"update:tool_call","title":"Search docs","toolCallId":"__testToolCall"}
    {"t":"<time>","type":"update:agent_message_chunk:text","text":"after"}
    {"t":"<time>","type":"done","cancelled":false}
    "
  `);
});

test("service commands", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");
  expect(await session.request("/service")).toMatchInlineSnapshot(`
    "[⚙️ System]
    /service
      /service systemd install - Install systemd service.
      /service exit - Exit acpella."
  `);
  await session.request("/service exit");
  expect(tester.onServiceExit.mock.calls).toMatchInlineSnapshot(`
    [
      [],
    ]
  `);
});

test("cancel command", async () => {
  const tester = await createHandlerTester();
  const sessionName = "test";
  const session = tester.createSession(sessionName);

  expect(await session.request("/cancel")).toMatchInlineSnapshot(`
    "[⚙️ System]
    No active agent turn."
  `);

  const result = session.requestStream("__wait_cancel__");
  await expect.poll(() => result.replies).toMatchObject({ length: 1 });
  expect(result.replies).toMatchInlineSnapshot(`
    [
      "cancel-before",
    ]
  `);
  result.replies.length = 0;

  expect(await session.request("/cancel")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Cancelled current agent turn."
  `);
  await result.promise;
  expect(result.replies).toMatchInlineSnapshot(`
    [
      "cancel-after",
      "[⚙️ System]
    Agent turn cancelled.",
    ]
  `);
});

test("serializes prompt requests for the same session", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  const result1 = session.requestStream("__wait_cancel__");
  const result2 = session.requestStream("hello");

  await expect.poll(() => result1.replies).toMatchObject({ length: 1 });
  expect(result1.replies).toMatchInlineSnapshot(`
    [
      "cancel-before",
    ]
  `);
  result1.replies.length = 0;

  expect(await session.request("/cancel")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Cancelled current agent turn."
  `);

  // first prompt holding off second prompt
  await result1.promise;
  expect(result1.replies).toMatchInlineSnapshot(`
    [
      "cancel-after",
      "[⚙️ System]
    Agent turn cancelled.",
    ]
  `);
  expect(result2.replies).toEqual([]);
  await result2.promise;
  expect(result2.replies).toMatchInlineSnapshot(`
    [
      "echo: hello",
    ]
  `);
});

test("session commands", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");
  expect(await session.request("/session")).toMatchInlineSnapshot(`
    "[⚙️ System]
    /session
      /session info [sessionName] - Show info about a session.
      /session list - List known agent sessions.
      /session new [agent] - Start a new agent session.
      /session load <sessionId|agent:sessionId> - Load an existing agent session.
      /session close [sessionId|agent:sessionId] - Close an agent session.
      /session verbose on [sessionName] - Enable tool-call output.
      /session verbose off [sessionName] - Disable tool-call output."
  `);
  expect(await session.request("/session help")).toMatchInlineSnapshot(`
    "[⚙️ System]
    /session
      /session info [sessionName] - Show info about a session.
      /session list - List known agent sessions.
      /session new [agent] - Start a new agent session.
      /session load <sessionId|agent:sessionId> - Load an existing agent session.
      /session close [sessionId|agent:sessionId] - Close an agent session.
      /session verbose on [sessionName] - Enable tool-call output.
      /session verbose off [sessionName] - Disable tool-call output."
  `);
  expect(await session.request("/session info")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: none
    verbose: off"
  `);
  expect(await session.request("/session list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    No sessions."
  `);
  expect(await session.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
  expect(await session.request("/session info")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: __testSession1
    verbose: off"
  `);
  expect(await session.request("/session list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test -> test:__testSession1 (active)"
  `);
  expect(await session.request("/session load")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Usage: /session load <sessionId|agent:sessionId>"
  `);
  expect(await session.request("/session new")).toMatchInlineSnapshot(`
    "[⚙️ System]
    New session ready."
  `);
  expect(await session.request("test-prompt")).toMatchInlineSnapshot(`"echo: test-prompt"`);
  expect(await session.request("/session info")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: __testSession2
    verbose: off"
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
  // /session info with explicit sessionName: exists
  const session2 = tester.createSession("other");
  expect(await session2.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
  expect(await session.request("/session info other")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: other
    agent: test
    agent session id: __testSession3
    verbose: off"
  `);
  // /session info with explicit sessionName: does not exist
  expect(await session.request("/session info no-such-session")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Unknown session: no-such-session"
  `);
});

test("session context usage", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  // Start a session
  expect(await session.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);

  // Before usage_update, no context shown
  expect(await session.request("/session info")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: __testSession1
    verbose: off"
  `);

  // Send a usage_update
  expect(await session.request("__usage_update:54321:200000")).toMatchInlineSnapshot(
    `"echo: __usage_update:54321:200000"`,
  );

  // After usage_update, context is shown in /session info
  expect(await session.request("/session info")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: __testSession1
    verbose: off
    context: 54321 / 200000 tokens (27%)"
  `);
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
      },
      "agentSessions": {
        "test": {
          "__testSession1": {
            "usage": {
              "used": 54321,
              "size": 200000,
              "updatedAt": <time>
            }
          }
        }
      }
    }"
  `);
});

test("verbose command toggles tool call output", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  expect(await session.request("/session verbose on")).toMatchInlineSnapshot(`
      "[⚙️ System]
      Tool call output: on"
    `);
  expect(await session.request("__tool:Read files")).toMatchInlineSnapshot(`
      "Tool: Read files
      echo: __tool:Read files"
    `);
  expect(await session.request("/session verbose off")).toMatchInlineSnapshot(`
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
  expect(await session.request("/session info")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: __testSession1
    verbose: off"
  `);
  expect(await session.request("/session verbose on")).toMatchInlineSnapshot(`
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
    /agent
      /agent list - List configured agents.
      /agent new <name> <command...> - Save a new agent.
      /agent remove <name> - Remove an agent.
      /agent default [name] - Show or set the default agent."
  `);
  expect(await session.request("/agent list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test -> node <cwd>/src/lib/test-agent.ts (default)"
  `);
  expect(await session.request("/agent new test-error no-such-command")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Saved new agent: test-error"
  `);
  expect(await session.request("/session new test-error")).toMatchInlineSnapshot(`
    "[⚙️ System]
    New session ready."
  `);
  await expect(session.request("test-prompt")).rejects.toMatchInlineSnapshot(
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
  expect(await session.request("/session info")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test-error
    agent session id: none
    verbose: off"
  `);
  expect(await session.request("/agent remove test-error")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Cannot remove agent: test-error
    1 session(s) still reference it."
  `);
  expect(await session.request("/session new test2")).toMatchInlineSnapshot(`
    "[⚙️ System]
    New session ready."
  `);
  expect(await session.request("test-prompt")).toMatchInlineSnapshot(`"echo: test-prompt"`);
  expect(await session.request("/session info")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test2
    agent session id: __testSession1
    verbose: off"
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
      },
      "agentSessions": {}
    }"
  `);
  expect(await session.request("/session load test:__testSession1")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Loaded session: test:__testSession1"
  `);
  expect(await session.request("/session info")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: __testSession1
    verbose: off"
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
      },
      "agentSessions": {}
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

test("cron reload command", async ({ onTestFinished }) => {
  vi.useFakeTimers({
    now: Date.parse("2026-04-18T00:00:00Z"),
  });
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const tester = await createHandlerTester();
  tester.cronRunner.start();
  onTestFinished(() => {
    tester.cronRunner.stop();
  });

  const session = tester.createSession("test", {
    metadata: { cronDeliveryTarget: { repl: true } },
  });
  expect(await session.request("/cron list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    No cron jobs."
  `);

  writeJsonFile(tester.config.cronFile, {
    version: 1,
    jobs: {
      "file-job": {
        id: "file-job",
        enabled: true,
        schedule: "2 * * * *",
        timezone: tester.config.timezone,
        prompt: "hello-from-file",
        target: {
          sessionName: "test",
          delivery: { repl: true },
        },
      },
    },
  });

  expect(await session.request("/cron reload")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Reloaded cron jobs."
  `);
  expect(await session.request("/cron list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - file-job [enabled]
      schedule: 2 * * * *
      timezone: Asia/Jakarta
      target session: test
      delivery target: repl
      next: 2026-04-18T07:02:00+07:00
      last: none"
  `);

  writeJsonFile(tester.config.cronFile, {
    version: 12.34,
    jobs: {},
  });
  expect(await session.request("/cron reload")).toContain(
    "[⚙️ System]\nFailed to reload cron jobs:",
  );
  expect(await session.request("/cron list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - file-job [enabled]
      schedule: 2 * * * *
      timezone: Asia/Jakarta
      target session: test
      delivery target: repl
      next: 2026-04-18T07:02:00+07:00
      last: none"
  `);

  vi.advanceTimersToNextTimer();
  vi.advanceTimersToNextTimer();
  expect(formatTime(Date.now(), tester.config.timezone)).toMatchInlineSnapshot(
    `"2026-04-18T07:02:00+07:00"`,
  );
  await vi.waitUntil(() => tester.cronDeliveries.length > 0);
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`
    [
      "echo: <trigger_metadata>
    trigger: cron
    cron_id: file-job
    scheduled_at: 2026-04-18T07:02:00+07:00
    started_at: 2026-04-18T07:02:00+07:00
    timezone: Asia/Jakarta
    session_name: test
    </trigger_metadata>

    hello-from-file
    ",
    ]
  `);
});

test("cron command", async ({ onTestFinished }) => {
  vi.useFakeTimers({
    now: Date.parse("2026-04-18T00:00:00Z"),
  });
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const tester = await createHandlerTester();
  tester.cronRunner.start();
  onTestFinished(() => {
    tester.cronRunner.stop();
  });

  const session = tester.createSession("test", {
    metadata: { cronDeliveryTarget: { repl: true } },
  });
  expect(await session.request("/cron status")).toMatchInlineSnapshot(`
    "[⚙️ System]
    cron runner: running
    jobs: 0
    enabled jobs: 0"
  `);
  expect(await session.request("/cron stop")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Cron runner stopped."
  `);
  expect(await session.request("/cron status")).toMatchInlineSnapshot(`
    "[⚙️ System]
    cron runner: stopped
    jobs: 0
    enabled jobs: 0"
  `);
  expect(await session.request("/cron start")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Cron runner started."
  `);
  expect(await session.request("/cron status")).toMatchInlineSnapshot(`
    "[⚙️ System]
    cron runner: running
    jobs: 0
    enabled jobs: 0"
  `);
  expect(await session.request("/cron add test-job * * * * * -- hello-cron"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Added cron job: test-job"
  `);
  expect(await session.request("/cron list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test-job [enabled]
      schedule: * * * * *
      timezone: Asia/Jakarta
      target session: test
      delivery target: repl
      next: 2026-04-18T07:01:00+07:00
      last: none"
  `);
  expect(await session.request("/cron show test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: test-job
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T07:01:00+07:00
    last: none
    prompt: hello-cron"
  `);
  expect(await session.request("/cron status")).toMatchInlineSnapshot(`
    "[⚙️ System]
    cron runner: running
    jobs: 1
    enabled jobs: 1"
  `);
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`[]`);

  vi.advanceTimersToNextTimer();
  expect(formatTime(Date.now(), tester.config.timezone)).toMatchInlineSnapshot(
    `"2026-04-18T07:01:00+07:00"`,
  );
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`[]`);
  expect(await session.request("/cron show test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: test-job
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T07:02:00+07:00
    last: running, scheduled 2026-04-18T00:01:00Z
    prompt: hello-cron"
  `);

  await vi.waitUntil(() => tester.cronDeliveries.length > 0);
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`
    [
      "echo: <trigger_metadata>
    trigger: cron
    cron_id: test-job
    scheduled_at: 2026-04-18T07:01:00+07:00
    started_at: 2026-04-18T07:01:00+07:00
    timezone: Asia/Jakarta
    session_name: test
    </trigger_metadata>

    hello-cron
    ",
    ]
  `);
  expect(await session.request("/cron show test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: test-job
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T07:02:00+07:00
    last: succeeded, scheduled 2026-04-18T00:01:00Z, finished 2026-04-18T00:01:00Z
    prompt: hello-cron"
  `);
  tester.cronDeliveries.length = 0;

  expect(await session.request("/cron add other-job 3 * * * * -- hello-other"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Added cron job: other-job"
  `);

  expect(await session.request("/cron disable test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Disabled cron job: test-job"
  `);
  expect(await session.request("/cron list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test-job [disabled]
      schedule: * * * * *
      timezone: Asia/Jakarta
      target session: test
      delivery target: repl
      next: none
      last: succeeded, scheduled 2026-04-18T00:01:00Z, finished 2026-04-18T00:01:00Z

    - other-job [enabled]
      schedule: 3 * * * *
      timezone: Asia/Jakarta
      target session: test
      delivery target: repl
      next: 2026-04-18T07:03:00+07:00
      last: none"
  `);

  vi.advanceTimersToNextTimer();
  vi.advanceTimersToNextTimer();
  expect(formatTime(Date.now(), tester.config.timezone)).toMatchInlineSnapshot(
    `"2026-04-18T07:03:00+07:00"`,
  );
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`[]`);
  expect(await session.request("/cron show other-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: other-job
    enabled: yes
    schedule: 3 * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T08:03:00+07:00
    last: running, scheduled 2026-04-18T00:03:00Z
    prompt: hello-other"
  `);

  await vi.waitUntil(() => tester.cronDeliveries.length > 0);
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`
    [
      "echo: <trigger_metadata>
    trigger: cron
    cron_id: other-job
    scheduled_at: 2026-04-18T07:03:00+07:00
    started_at: 2026-04-18T07:03:00+07:00
    timezone: Asia/Jakarta
    session_name: test
    </trigger_metadata>

    hello-other
    ",
    ]
  `);
  expect(await session.request("/cron list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test-job [disabled]
      schedule: * * * * *
      timezone: Asia/Jakarta
      target session: test
      delivery target: repl
      next: none
      last: succeeded, scheduled 2026-04-18T00:01:00Z, finished 2026-04-18T00:01:00Z

    - other-job [enabled]
      schedule: 3 * * * *
      timezone: Asia/Jakarta
      target session: test
      delivery target: repl
      next: 2026-04-18T08:03:00+07:00
      last: succeeded, scheduled 2026-04-18T00:03:00Z, finished 2026-04-18T00:03:00Z"
  `);

  expect(await session.request("/cron enable test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Enabled cron job: test-job"
  `);
  expect(await session.request("/cron status")).toMatchInlineSnapshot(`
    "[⚙️ System]
    cron runner: running
    jobs: 2
    enabled jobs: 2"
  `);
  expect(await session.request("/cron delete test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Deleted cron job: test-job"
  `);
  expect(await session.request("/cron list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - other-job [enabled]
      schedule: 3 * * * *
      timezone: Asia/Jakarta
      target session: test
      delivery target: repl
      next: 2026-04-18T08:03:00+07:00
      last: succeeded, scheduled 2026-04-18T00:03:00Z, finished 2026-04-18T00:03:00Z"
  `);
  expect(await session.request("/cron status")).toMatchInlineSnapshot(`
    "[⚙️ System]
    cron runner: running
    jobs: 1
    enabled jobs: 1"
  `);
});

test("cron error delivery", async ({ onTestFinished }) => {
  vi.useFakeTimers({
    now: Date.parse("2026-04-18T00:00:00Z"),
  });
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const tester = await createHandlerTester();
  tester.cronRunner.start();
  onTestFinished(() => {
    tester.cronRunner.stop();
  });

  const session = tester.createSession("test", {
    metadata: { cronDeliveryTarget: { repl: true } },
  });
  expect(await session.request("/cron add test-job * * * * * -- __throw_error__"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Added cron job: test-job"
  `);
  expect(await session.request("/cron show test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: test-job
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T07:01:00+07:00
    last: none
    prompt: __throw_error__"
  `);
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`[]`);

  vi.advanceTimersToNextTimer();
  expect(formatTime(Date.now(), tester.config.timezone)).toMatchInlineSnapshot(
    `"2026-04-18T07:01:00+07:00"`,
  );
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`[]`);
  expect(await session.request("/cron show test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: test-job
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T07:02:00+07:00
    last: running, scheduled 2026-04-18T00:01:00Z
    prompt: __throw_error__"
  `);

  await vi.waitUntil(() => tester.cronDeliveries.length > 0);
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`
    [
      "[cron] test-job failed

    scheduled_at: 2026-04-18T07:01:00+07:00
    started_at: 2026-04-18T07:01:00+07:00
    timezone: Asia/Jakarta
    session_name: test

    Error:
    Internal error
    ",
    ]
  `);
  expect(await session.request("/cron show test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: test-job
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T07:02:00+07:00
    last: failed, scheduled 2026-04-18T00:01:00Z, finished 2026-04-18T00:01:00Z, error: Internal error
    prompt: __throw_error__"
  `);
});

test("cron add with session name", async ({ onTestFinished }) => {
  vi.useFakeTimers({
    now: Date.parse("2026-04-18T00:00:00Z"),
  });
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const tester = await createHandlerTester();

  // setup deliver target sessions
  const targetSession1 = tester.createSession("tg-12345");
  await targetSession1.request("hello");
  const targetSession2 = tester.createSession("tg-12345-678");
  await targetSession2.request("hello");

  // setup cron from repl
  const session = tester.createSession("test", {
    metadata: { cronDeliveryTarget: { repl: true } },
  });

  // With only chatId
  expect(await session.request("/cron add tg-job * * * * * --session tg-12345 -- hello-cron"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Added cron job: tg-job"
  `);
  expect(await session.request("/cron show tg-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: tg-job
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: tg-12345
    delivery target: telegram:12345
    next: 2026-04-18T07:01:00+07:00
    last: none
    prompt: hello-cron"
  `);

  // With chatId and messageThreadId
  expect(
    await session.request("/cron add tg-job2 * * * * * --session tg-12345-678 -- hello-thread"),
  ).toMatchInlineSnapshot(`
    "[⚙️ System]
    Added cron job: tg-job2"
  `);
  expect(await session.request("/cron show tg-job2")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: tg-job2
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: tg-12345-678
    delivery target: telegram:12345/678
    next: 2026-04-18T07:01:00+07:00
    last: none
    prompt: hello-thread"
  `);

  // Multi-word prompt with sessionName
  expect(await session.request("/cron add tg-job3 * * * * * --session tg-12345 -- hello world"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Added cron job: tg-job3"
  `);
  expect(await session.request("/cron show tg-job3")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: tg-job3
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: tg-12345
    delivery target: telegram:12345
    next: 2026-04-18T07:01:00+07:00
    last: none
    prompt: hello world"
  `);
});
