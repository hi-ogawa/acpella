import fs from "node:fs";
import { expect, test, vi } from "vitest";
import { TEST_AGENT_COMMAND } from "../state.ts";
import { writeJsonFile } from "../utils/fs.ts";
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

    /shell
      /shell [--timeout=<seconds>] <command...> - Run a shell command from ACPELLA_HOME with a default 10s timeout.

    /session
      /session info [--target <sessionName>] - Show info about a session.
      /session list - List acpella sessions.
      /session new [--target <sessionName>] [agent|agent:sessionId] - Start a new agent session.
      /session close [--target <sessionName>] - Close an acpella session.
      /session config [--target sessionName] [verbose=off|tool|thinking|all] [renew=off|daily|daily:N] - Show or update session config.

    /agent
      /agent list - List configured agents.
      /agent sessions [agent] - List backend ACP sessions.
      /agent close-session <agent:sessionId> - Close a backend ACP session.
      /agent new <name> <command...> - Save a new agent.
      /agent remove <name> - Remove an agent.
      /agent default [name] - Show or set the default agent.

    /cron
      /cron status - Show cron scheduler status.
      /cron start - Start cron scheduler.
      /cron stop - Stop cron scheduler.
      /cron add <id> <minute> <hour> <day-of-month> <month> <day-of-week> [--once] [--target <sessionName>] -- <prompt...> - Add a cron job.
      /cron update <id> <minute> <hour> <day-of-month> <month> <day-of-week> [--target <sessionName>] [-- <prompt...>] - Update a cron job.
      /cron list [--full] - List cron jobs.
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
    {"t":"<time>","type":"done","cancelled":false,"response":{"stopReason":"end_turn"}}
    "
  `);
  await session.request("__multiple_chunks_with_messageId:world");
  await session.request("__chunk_tool:Search docs");
  expect(readLogs()).toMatchInlineSnapshot(`
    "
    {"t":"<time>","type":"prompt","text":"__multiple_chunks:hello"}
    {"t":"<time>","type":"update:agent_message_chunk:text","batch":[{"t":"<time>","text":"echo-1: hello"},{"t":"<time>","text":"echo-2: hello"}]}
    {"t":"<time>","type":"done","cancelled":false,"response":{"stopReason":"end_turn"}}
    {"t":"<time>","type":"prompt","text":"__multiple_chunks_with_messageId:world"}
    {"t":"<time>","type":"update:agent_message_chunk:text:__testMessage","batch":[{"t":"<time>","text":"echo-1: world"},{"t":"<time>","text":"echo-2: world"}]}
    {"t":"<time>","type":"done","cancelled":false,"response":{"stopReason":"end_turn"}}
    {"t":"<time>","type":"prompt","text":"__chunk_tool:Search docs"}
    {"t":"<time>","type":"update:agent_message_chunk:text","text":"before"}
    {"t":"<time>","type":"update:tool_call","title":"Search docs","toolCallId":"__testToolCall"}
    {"t":"<time>","type":"update:agent_message_chunk:text","text":"after"}
    {"t":"<time>","type":"done","cancelled":false,"response":{"stopReason":"end_turn"}}
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

test("session info and list show active turn", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  const result = session.requestStream("__wait_cancel__");
  await expect.poll(() => result.replies).toMatchObject({ length: 1 });

  expect(await session.request("/session info")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: __testSession1
    updated at: <time>
    verbose: thinking
    renew: off
    active turn: yes"
  `);
  expect(await session.request("/session list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - session: test
      agent: test
      agent session id: __testSession1
      updated at: <time>
      verbose: thinking
      renew: off
      active turn: yes"
  `);

  await session.request("/cancel");
  await result.promise;

  expect(await session.request("/session info")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: __testSession1
    updated at: <time>
    verbose: thinking
    renew: off
    active turn: no"
  `);
  expect(await session.request("/session list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - session: test
      agent: test
      agent session id: __testSession1
      updated at: <time>
      verbose: thinking
      renew: off
      active turn: no"
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

test("extra commands", async () => {
  const echo = vi.fn(async (options: { args: string[]; text: string }) => options);
  const captureInput = vi.fn(
    async (options: { args: string[]; input: { head: string[]; body?: string } }) => options,
  );
  const tester = await createHandlerTester({
    extraCommands: {
      extra: {
        description: "Extra test commands",
        commands: [
          {
            tokens: ["echo"],
            usage: "/extra echo <args...>",
            description: "Echo command input.",
            withArgs: true,
            run: async ({ args, text, reply }) => {
              await echo({ args, text });
              await reply.system("echoed");
            },
          },
          {
            tokens: ["body"],
            usage: "/extra body <args...> -- <body>",
            description: "Capture command body.",
            withArgs: true,
            run: async ({ args, input, reply }) => {
              await captureInput({ args, input });
              await reply.system("captured");
            },
          },
        ],
      },
    },
  });
  const session = tester.createSession("test");

  expect(await session.request("/extra")).toMatchInlineSnapshot(`
    "[⚙️ System]
    /extra
      /extra echo <args...> - Echo command input.
      /extra body <args...> -- <body> - Capture command body."
  `);
  expect(await session.request("/extra echo one two\nthree")).toMatchInlineSnapshot(`
    "[⚙️ System]
    echoed"
  `);
  expect(echo.mock.calls).toMatchInlineSnapshot(`
    [
      [
        {
          "args": [
            "one",
            "two",
            "three",
          ],
          "text": "/extra echo one two
    three",
        },
      ],
    ]
  `);
  expect(await session.request("/extra body title -- first\n\nsecond -- later"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    captured"
  `);
  expect(captureInput).toHaveBeenCalledWith({
    args: ["title", "--", "first", "second", "--", "later"],
    input: {
      head: ["title"],
      body: "first\n\nsecond -- later",
    },
  });
});
