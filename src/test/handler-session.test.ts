import { expect, test, vi } from "vitest";
import { advanceTimersTo } from "./helper.ts";
import { createHandlerTester } from "./tester.ts";

test("session help, info, and list", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");
  expect(await session.request("/session")).toMatchInlineSnapshot(`
    "[⚙️ System]
    /session
      /session info [--target <sessionName>] - Show info about a session.
      /session list - List acpella sessions.
      /session new [--target <sessionName>] [agent|agent:sessionId] - Start a new agent session.
      /session close [--target <sessionName>] - Close an acpella session.
      /session config [--target sessionName] [verbose=off|tool|thinking|all] [renew=off|daily|daily:N] - Show or update session config."
  `);
  expect(await session.request("/session help")).toMatchInlineSnapshot(`
    "[⚙️ System]
    /session
      /session info [--target <sessionName>] - Show info about a session.
      /session list - List acpella sessions.
      /session new [--target <sessionName>] [agent|agent:sessionId] - Start a new agent session.
      /session close [--target <sessionName>] - Close an acpella session.
      /session config [--target sessionName] [verbose=off|tool|thinking|all] [renew=off|daily|daily:N] - Show or update session config."
  `);
  expect(await session.request("/session info")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: test
    agent: test
    agent session id: none
    updated at: none
    verbose: thinking
    renew: off
    active turn: no"
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

test("starts a fresh agent session", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  expect(await session.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
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
    updated at: <time>
    verbose: thinking
    renew: off
    active turn: no"
  `);
  expect(await session.request("__session")).toMatchInlineSnapshot(`"session: __testSession2"`);
  expect(await session.request("/session list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - session: test
      agent: test
      agent session id: __testSession2
      updated at: <time>
      verbose: thinking
      renew: off
      active turn: no"
  `);
  expect(await session.request("/agent sessions")).toMatchInlineSnapshot(`
    "[⚙️ System]
    test:
    - __testSession1
    - __testSession2"
  `);
});

test("rejects unknown session agents", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  expect(await session.request("/session new __testSession1")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Unknown agent: __testSession1"
  `);
  expect(await session.request("/session new no-such-agent")).toMatchInlineSnapshot(
    `
    "[⚙️ System]
    Unknown agent: no-such-agent"
  `,
  );
});

test("resets a targeted session mapping", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");
  expect(await session.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);

  const session2 = tester.createSession("other");
  expect(await session2.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
  expect(await session.request("/session info --target other")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: other
    agent: test
    agent session id: __testSession2
    updated at: <time>
    verbose: thinking
    renew: off
    active turn: no"
  `);
  expect(await session.request("/session new --target other")).toMatchInlineSnapshot(`
    "[⚙️ System]
    New session ready."
  `);
  expect(await session.request("/session info --target other")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: other
    agent: test
    agent session id: none
    updated at: <time>
    verbose: thinking
    renew: off
    active turn: no"
  `);
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
});

test("rejects unknown session targets", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  expect(await session.request("/session info --target no-such-session")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Unknown session: no-such-session"
  `);
  expect(await session.request("/session new --target no-such-session")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Unknown session: no-such-session"
  `);
  expect(await session.request("/session info no-such-session")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Invalid argument: no-such-session"
  `);

  expect(await session.request("/session close --target no-such-session")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Unknown session: no-such-session"
  `);
});

test("requires removing a mapping before closing its agent session", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("admin");
  const withAgentSession = tester.createSession("with-agent-session");
  expect(await withAgentSession.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
  expect(await session.request("/session info --target with-agent-session")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: with-agent-session
    agent: test
    agent session id: __testSession1
    updated at: <time>
    verbose: thinking
    renew: off
    active turn: no"
  `);
  expect(await session.request("/agent close-session test:__testSession1")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Cannot close agent session: test:__testSession1
    Referenced sessions:
    - with-agent-session
      agent session id: __testSession1
      updated at: <time>"
  `);
  expect(await session.request("/session close --target with-agent-session"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Session closed: with-agent-session."
  `);
  expect(await session.request("/session info --target with-agent-session")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Unknown session: with-agent-session"
  `);
  expect(await session.request("/agent sessions test")).toContain("__testSession1");
  expect(await session.request("/agent close-session test:__testSession1")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Agent session closed: test:__testSession1."
  `);
  expect(await session.request("/agent sessions test")).not.toContain("__testSession1");
});

test("closes a targeted mapping without an agent session", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("admin");
  const retained = tester.createSession("retained");
  const withoutAgentSession = tester.createSession("without-agent-session");
  expect(await retained.request("/session new")).toMatchInlineSnapshot(`
    "[⚙️ System]
    New session ready."
  `);
  expect(await withoutAgentSession.request("/session config renew=off")).toMatchInlineSnapshot(`
    "[⚙️ System]
    verbose: thinking
    renew: off"
  `);
  expect(await session.request("/session info --target without-agent-session"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    session: without-agent-session
    agent: test
    agent session id: none
    updated at: none
    verbose: thinking
    renew: off
    active turn: no"
  `);
  expect(await session.request("/session close --target without-agent-session"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Session closed: without-agent-session."
  `);
  expect(await session.request("/session info --target retained")).toContain("session: retained");
});

test("attaches an agent session to a targeted acpella session", async () => {
  const tester = await createHandlerTester();
  const source = tester.createSession("source");
  const target = tester.createSession("target");

  expect(await source.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
  expect(await target.request("/session new")).toMatchInlineSnapshot(`
    "[⚙️ System]
    New session ready."
  `);
  expect(await source.request("/session new --target target test:__testSession1"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Loaded session: test:__testSession1"
  `);
  expect(await source.request("/session info --target target")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: target
    agent: test
    agent session id: __testSession1
    updated at: none
    verbose: thinking
    renew: off
    active turn: no"
  `);
});

test("closes the current session mapping without an agent session", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  expect(await session.request("/session config renew=off")).toMatchInlineSnapshot(`
    "[⚙️ System]
    verbose: thinking
    renew: off"
  `);
  expect(await session.request("/session close")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Session closed: test."
  `);
  expect(await session.request("/session list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    No sessions."
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
    updated at: <time>
    verbose: thinking
    renew: off
    active turn: no"
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
    updated at: <time>
    verbose: thinking
    renew: off
    active turn: no
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
    updated at: <time>
    verbose: thinking
    renew: off
    active turn: no"
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

test("formats complete thinking segments", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test", {
    formatThinking: (text) => `> ${text}`,
  });

  expect(await session.request("__thinking_chunks:Review |plan")).toMatchInlineSnapshot(`
    "> [thinking] Review plan
    echo: __thinking_chunks:Review |plan"
  `);
  expect(await session.request("__thinking_only:Finish up")).toMatchInlineSnapshot(
    `"> [thinking] Finish up"`,
  );
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
