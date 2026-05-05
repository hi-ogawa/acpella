/*
Coverage checklist:

- /status
  - [x] output, including default agent
  - [x] shows in-flight sessions
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
  - [x] list local state only
  - [ ] list with multiple agents
  - [x] verbose tool
  - [x] verbose off
  - [x] verbose suppresses tool call output
  - [x] verbose includes tool call output when enabled
  - [ ] verbose is isolated per acpella session
  - [x] renew stale session when chat prompt crosses daily boundary
- /agent
  - [x] list
  - [x] sessions
  - [x] sessions reports backend failures
  - [x] bare usage output
  - [x] new
  - [x] auto reloads external state file changes
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
import { TEST_AGENT_COMMAND } from "../state.ts";
import { writeJsonFile } from "../utils/fs.ts";
import { advanceTimersTo } from "./helper.ts";
import { createHandlerTester, sanitizeOutput } from "./tester.ts";

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
      /session info [--target <sessionName>] - Show info about a session.
      /session list - List acpella sessions.
      /session new [agent] - Start a new agent session.
      /session load <sessionId|agent:sessionId> - Load an existing agent session.
      /session close [sessionId|agent:sessionId] - Close an agent session.
      /session config [--target sessionName] [verbose=off|tool|thinking|all] [renew=off|daily|daily:N] - Show or update session config.

    /agent
      /agent list - List configured agents.
      /agent sessions [agent] - List backend ACP sessions.
      /agent new <name> <command...> - Save a new agent.
      /agent remove <name> - Remove an agent.
      /agent default [name] - Show or set the default agent.

    /cron
      /cron status - Show cron scheduler status.
      /cron start - Start cron scheduler.
      /cron stop - Stop cron scheduler.
      /cron add <id> <minute> <hour> <day-of-month> <month> <day-of-week> [--target <sessionName>] -- <prompt...> - Add a cron job.
      /cron update <id> <minute> <hour> <day-of-month> <month> <day-of-week> [--target <sessionName>] [-- <prompt...>] - Update a cron job.
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
    env file: (none)
    home: <home>
    current session: test"
  `);
  expect(await session.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
  expect(tester.readStateFile()).toMatchInlineSnapshot(`
    "{
      "version": 2,
      "defaultAgent": "test",
      "agents": {
        "test": {
          "command": "node <cwd>/src/bin/test-agent.js"
        }
      },
      "sessions": {
        "test": {
          "agentKey": "test",
          "agentSessionId": "__testSession1",
          "verbose": "thinking",
          "updatedAt": <time>
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
  await session.request("__multiple_chunks_with_messageId:world");
  await session.request("__chunk_tool:Search docs");
  expect(readLogs()).toMatchInlineSnapshot(`
    "
    {"t":"<time>","type":"prompt","text":"__multiple_chunks:hello"}
    {"t":"<time>","type":"update:agent_message_chunk:text","batch":[{"t":"<time>","text":"echo-1: hello"},{"t":"<time>","text":"echo-2: hello"}]}
    {"t":"<time>","type":"done","cancelled":false}
    {"t":"<time>","type":"prompt","text":"__multiple_chunks_with_messageId:world"}
    {"t":"<time>","type":"update:agent_message_chunk:text:__testMessage","batch":[{"t":"<time>","text":"echo-1: world"},{"t":"<time>","text":"echo-2: world"}]}
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

test("status shows in-flight sessions", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  const result = session.requestStream("__wait_cancel__");
  await expect.poll(() => result.replies).toMatchObject({ length: 1 });

  expect(await session.request("/status")).toMatchInlineSnapshot(`
    "[⚙️ System]
    status: running
    version: v1.0.0-test
    default agent: test
    env file: (none)
    home: <home>
    current session: test
    in-flight sessions:
    - test -> test:__testSession1"
  `);

  await session.request("/cancel");
  await result.promise;

  expect(await session.request("/status")).toMatchInlineSnapshot(`
    "[⚙️ System]
    status: running
    version: v1.0.0-test
    default agent: test
    env file: (none)
    home: <home>
    current session: test"
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
      /session info [--target <sessionName>] - Show info about a session.
      /session list - List acpella sessions.
      /session new [agent] - Start a new agent session.
      /session load <sessionId|agent:sessionId> - Load an existing agent session.
      /session close [sessionId|agent:sessionId] - Close an agent session.
      /session config [--target sessionName] [verbose=off|tool|thinking|all] [renew=off|daily|daily:N] - Show or update session config."
  `);
  expect(await session.request("/session help")).toMatchInlineSnapshot(`
    "[⚙️ System]
    /session
      /session info [--target <sessionName>] - Show info about a session.
      /session list - List acpella sessions.
      /session new [agent] - Start a new agent session.
      /session load <sessionId|agent:sessionId> - Load an existing agent session.
      /session close [sessionId|agent:sessionId] - Close an agent session.
      /session config [--target sessionName] [verbose=off|tool|thinking|all] [renew=off|daily|daily:N] - Show or update session config."
  `);
  expect(await session.request("/session info")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: none
    verbose: thinking
    renew: off"
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
    verbose: thinking
    renew: off"
  `);
  expect(await session.request("/session list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - session: test
      agent: test
      agent session id: __testSession1
      verbose: thinking
      renew: off"
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
    verbose: thinking
    renew: off"
  `);
  expect(await session.request("__session")).toMatchInlineSnapshot(`"session: __testSession2"`);
  expect(await session.request("/session list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - session: test
      agent: test
      agent session id: __testSession2
      verbose: thinking
      renew: off"
  `);
  expect(await session.request("/agent sessions")).toMatchInlineSnapshot(`
    "[⚙️ System]
    test:
    - __testSession1
    - __testSession2"
  `);
  expect(await session.request("/session new no-such-agent")).toMatchInlineSnapshot(
    `
    "[⚙️ System]
    Unknown agent: no-such-agent"
  `,
  );
  // /session info with explicit target sessionName: exists
  const session2 = tester.createSession("other");
  expect(await session2.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
  expect(await session.request("/session info --target other")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: other
    agent: test
    agent session id: __testSession3
    verbose: thinking
    renew: off"
  `);
  // /session info with explicit target sessionName: does not exist
  expect(await session.request("/session info --target no-such-session")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Unknown session: no-such-session"
  `);
  expect(await session.request("/session info no-such-session")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Invalid argument: no-such-session"
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
    verbose: thinking
    renew: off"
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
    verbose: thinking
    renew: off
    context: 54321 / 200000 tokens (27%)"
  `);
  expect(tester.readStateFile()).toMatchInlineSnapshot(`
    "{
      "version": 2,
      "defaultAgent": "test",
      "agents": {
        "test": {
          "command": "node <cwd>/src/bin/test-agent.js"
        }
      },
      "sessions": {
        "test": {
          "agentKey": "test",
          "agentSessionId": "__testSession1",
          "verbose": "thinking",
          "updatedAt": <time>
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

test("session config toggles verbose output", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  expect(await session.request("/session config verbose=tool")).toMatchInlineSnapshot(`
      "[⚙️ System]
      verbose: tool
      renew: off"
    `);
  expect(await session.request("__tool:Read files")).toMatchInlineSnapshot(`
      "Tool: Read files
      echo: __tool:Read files"
    `);
  expect(await session.request("/session config verbose=off")).toMatchInlineSnapshot(`
      "[⚙️ System]
      verbose: off
      renew: off"
    `);
  expect(await session.request("__tool:Search docs")).toMatchInlineSnapshot(
    `"echo: __tool:Search docs"`,
  );
  expect(await session.request("__chunk_tool:Search docs")).toMatchInlineSnapshot(`
      "before
      after"
    `);
  expect(await session.request("__thinking:Hidden thought")).toMatchInlineSnapshot(
    `"echo: __thinking:Hidden thought"`,
  );
  expect(await session.request("/session config verbose=thinking")).toMatchInlineSnapshot(`
      "[⚙️ System]
      verbose: thinking
      renew: off"
    `);
  expect(await session.request("__thinking:Review plan")).toMatchInlineSnapshot(`
      "[thinking] Review plan
      echo: __thinking:Review plan"
    `);
  expect(await session.request("__tool:Search docs")).toMatchInlineSnapshot(
    `"echo: __tool:Search docs"`,
  );
  expect(await session.request("/session info")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: __testSession1
    verbose: thinking
    renew: off"
  `);
  expect(await session.request("/session config verbose=tool")).toMatchInlineSnapshot(`
      "[⚙️ System]
      verbose: tool
      renew: off"
    `);
  expect(await session.request("__tool:Edit file")).toMatchInlineSnapshot(`
      "Tool: Edit file
      echo: __tool:Edit file"
    `);
});

test("session config command", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  // Show current config with no args
  expect(await session.request("/session config")).toMatchInlineSnapshot(`
    "[⚙️ System]
    verbose: thinking
    renew: off"
  `);

  // Update verbose only
  expect(await session.request("/session config verbose=tool")).toMatchInlineSnapshot(`
    "[⚙️ System]
    verbose: tool
    renew: off"
  `);

  // Update renew only
  expect(await session.request("/session config renew=daily")).toMatchInlineSnapshot(`
    "[⚙️ System]
    verbose: tool
    renew: daily at 04:00 Asia/Jakarta"
  `);

  // Update both atomically
  expect(await session.request("/session config verbose=thinking renew=daily:6"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    verbose: thinking
    renew: daily at 06:00 Asia/Jakarta"
  `);

  // Clear renew explicitly
  expect(await session.request("/session config renew=off")).toMatchInlineSnapshot(`
    "[⚙️ System]
    verbose: thinking
    renew: off"
  `);

  // Empty renew is invalid
  await expect(session.request("/session config renew=")).rejects.toMatchInlineSnapshot(
    `[Error: Invalid session renewal policy: ]`,
  );

  // Unknown key errors with list of supported keys
  await expect(session.request("/session config label=heartbeat")).rejects.toMatchInlineSnapshot(`
    [Error: Unknown key: label
    Supported keys: renew, verbose]
  `);

  // Explicit sessionName before key=value pairs
  const session2 = tester.createSession("other");
  // Create session2 in state first so it can be targeted by name
  expect(await session2.request("/session config verbose=thinking")).toMatchInlineSnapshot(`
    "[⚙️ System]
    verbose: thinking
    renew: off"
  `);
  // Now configure from session1 targeting session2 via --target
  expect(await session.request("/session config --target other verbose=tool"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    verbose: tool
    renew: off"
  `);
  // Verify session2 config changed
  expect(await session2.request("/session config")).toMatchInlineSnapshot(`
    "[⚙️ System]
    verbose: tool
    renew: off"
  `);
  // --target with unknown session name
  expect(await session.request("/session config --target no-such verbose=tool"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Unknown session: no-such"
  `);
  // --target with missing value
  await expect(session.request("/session config --target")).rejects.toMatchInlineSnapshot(
    `[Error: Missing value for --target]`,
  );
});

test("agent command", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");
  expect(await session.request("/agent")).toMatchInlineSnapshot(`
    "[⚙️ System]
    /agent
      /agent list - List configured agents.
      /agent sessions [agent] - List backend ACP sessions.
      /agent new <name> <command...> - Save a new agent.
      /agent remove <name> - Remove an agent.
      /agent default [name] - Show or set the default agent."
  `);
  expect(await session.request("/agent list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test -> node <cwd>/src/bin/test-agent.js (default)"
  `);
  expect(await session.request("/agent sessions")).toMatchInlineSnapshot(`
    "[⚙️ System]
    test:
      none"
  `);
  expect(await session.request("/agent new test-error no-such-command")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Saved new agent: test-error"
  `);
  expect(await session.request("/agent sessions test-error")).toMatchInlineSnapshot(`
    "[⚙️ System]
    test-error:
      error: ACP agent failed to start: spawn no-such-command ENOENT"
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
    - test -> node <cwd>/src/bin/test-agent.js (default)
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
    verbose: thinking
    renew: off"
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
    verbose: thinking
    renew: off"
  `);
  expect(await session.request("/session list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - session: test
      agent: test2
      agent session id: __testSession1
      verbose: thinking
      renew: off"
  `);
  expect(await session.request("/agent remove test-error")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Removed agent: test-error"
  `);
  expect(tester.readStateFile()).toMatchInlineSnapshot(`
    "{
      "version": 2,
      "defaultAgent": "test2",
      "agents": {
        "test": {
          "command": "node <cwd>/src/bin/test-agent.js"
        },
        "test2": {
          "command": "node <cwd>/src/bin/test-agent.js"
        }
      },
      "sessions": {
        "test": {
          "agentKey": "test2",
          "agentSessionId": "__testSession1",
          "verbose": "thinking",
          "updatedAt": <time>
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
    verbose: thinking
    renew: off"
  `);
  expect(await session.request("/session close test2:__testSession1")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Session closed: test2:__testSession1."
  `);
  expect(tester.readStateFile()).toMatchInlineSnapshot(`
    "{
      "version": 2,
      "defaultAgent": "test2",
      "agents": {
        "test": {
          "command": "node <cwd>/src/bin/test-agent.js"
        },
        "test2": {
          "command": "node <cwd>/src/bin/test-agent.js"
        }
      },
      "sessions": {
        "test": {
          "agentKey": "test",
          "agentSessionId": "__testSession1",
          "verbose": "thinking",
          "updatedAt": <time>
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
      promptMetadata: {
        timestamp: Date.UTC(2024, 0, 2, 3, 4, 5),
        extraKey: "extraValue",
      },
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
    extraKey: extraValue
    </message_metadata>
    __keep_metadata: ok"
  `);
});

test("state auto reloads external state file changes", async ({ onTestFinished }) => {
  vi.useFakeTimers({
    now: Date.parse("2026-04-18T07:00:00+07:00"),
  });
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const tester = await createHandlerTester();
  const session = tester.createSession("test");
  expect(await session.request("/agent list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test -> node <cwd>/src/bin/test-agent.js (default)"
  `);

  writeJsonFile(tester.config.stateFile, {
    version: 2,
    defaultAgent: "test",
    agents: {
      test: { command: TEST_AGENT_COMMAND },
      "file-agent": { command: "file-agent-command" },
    },
    sessions: {},
    agentSessions: {},
  });

  vi.advanceTimersByTime(1250);
  expect(await session.request("/agent list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test -> node <cwd>/src/bin/test-agent.js (default)
    - file-agent -> file-agent-command"
  `);

  {
    using consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    writeJsonFile(tester.config.stateFile, {
      version: 12.34,
      defaultAgent: "test",
      agents: {},
      sessions: {},
      agentSessions: {},
    });
    vi.advanceTimersByTime(1250);
    expect(consoleError.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "[state] Failed to reload state after external state file change: [
        {
          "code": "invalid_value",
          "values": [
            2
          ],
          "path": [
            "version"
          ],
          "message": "Invalid input: expected 2"
        }
      ]",
        ],
      ]
    `);
  }

  expect(await session.request("/agent list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test -> node <cwd>/src/bin/test-agent.js (default)
    - file-agent -> file-agent-command"
  `);
});

test("session renews stale chat prompt after daily boundary", async ({ onTestFinished }) => {
  // Timeline:
  // - 03:30: enable daily renewal at 04:00 and create __testSession1.
  // - 03:50: chat prompt stays on __testSession1 before the boundary.
  // - 04:30: chat prompt crosses the boundary and creates __testSession2.
  vi.useFakeTimers({
    now: Date.parse("2026-04-18T03:30:00+07:00"),
  });
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  expect(await session.request("/session config renew=daily:4")).toMatchInlineSnapshot(`
    "[⚙️ System]
    verbose: thinking
    renew: daily at 04:00 Asia/Jakarta"
  `);

  expect(await session.request("__session")).toMatchInlineSnapshot(`"session: __testSession1"`);

  advanceTimersTo("2026-04-18T03:50:00+07:00");
  expect(await session.request("__session")).toMatchInlineSnapshot(`"session: __testSession1"`);

  advanceTimersTo("2026-04-18T04:30:00+07:00");
  expect(await session.request("__session")).toMatchInlineSnapshot(`"session: __testSession2"`);
});
