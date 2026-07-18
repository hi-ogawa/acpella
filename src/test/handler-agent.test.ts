import { expect, test } from "vitest";
import { TEST_AGENT_COMMAND } from "../state.ts";
import { createHandlerTester } from "./tester.ts";

test("agent help and list", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");
  expect(await session.request("/agent")).toMatchInlineSnapshot(`
    "[⚙️ System]
    /agent
      /agent list - List configured agents.
      /agent sessions [agent] - List backend ACP sessions.
      /agent close-session <agent:sessionId> - Close a backend ACP session.
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
});

test("reports backend agent failures", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  expect(await session.request("/agent new test-error no-such-command")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Saved new agent: test-error"
  `);
  expect(await session.request("/agent sessions test-error")).toMatchInlineSnapshot(`
    "[⚙️ System]
    test-error:
      error: ACP agent failed to start: spawn no-such-command ENOENT"
  `);
  expect(await session.request("/agent close-session test-error:session-id"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Failed to close agent session: test-error:session-id
    ACP agent failed to start: spawn no-such-command ENOENT"
  `);
  expect(await session.request("/session new test-error")).toMatchInlineSnapshot(`
    "[⚙️ System]
    New session ready."
  `);
  await expect(session.request("test-prompt")).rejects.toMatchInlineSnapshot(
    `[Error: ACP agent failed to start: spawn no-such-command ENOENT]`,
  );
});

test("rejects invalid agent keys", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

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
    - test -> node <cwd>/src/bin/test-agent.js (default)"
  `);
});

test("sets and queries the default agent", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

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
  const other = tester.createSession("other");
  expect(await other.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
  expect(await session.request("/session info --target other")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: other
    agent: test2
    agent session id: __testSession1
    updated at: <time>
    verbose: thinking
    renew: off
    active turn: no"
  `);
});

test("starts a fresh session with a named agent", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  expect(await session.request(`/agent new test2 ${TEST_AGENT_COMMAND}`)).toMatchInlineSnapshot(`
    "[⚙️ System]
    Saved new agent: test2"
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
    updated at: <time>
    verbose: thinking
    renew: off
    active turn: no"
  `);
  expect(await session.request("/session list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - session: test
      agent: test2
      agent session id: __testSession1
      updated at: <time>
      verbose: thinking
      renew: off
      active turn: no"
  `);
});

test("qualifies agent session attachment and closure by agent", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  expect(await session.request(`/agent new test2 ${TEST_AGENT_COMMAND}`)).toMatchInlineSnapshot(`
    "[⚙️ System]
    Saved new agent: test2"
  `);
  expect(await session.request("/session new test2")).toMatchInlineSnapshot(`
    "[⚙️ System]
    New session ready."
  `);
  expect(await session.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
  expect(await session.request("/session new test:__testSession1")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Loaded session: test:__testSession1"
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
  expect(await session.request("/agent close-session test2:__testSession1")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Agent session closed: test2:__testSession1."
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

test("resets a targeted session with a named agent", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("admin");

  expect(await session.request(`/agent new test2 ${TEST_AGENT_COMMAND}`)).toMatchInlineSnapshot(`
    "[⚙️ System]
    Saved new agent: test2"
  `);
  expect(await session.request("/agent default test2")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Set default agent: test2"
  `);
  const session2 = tester.createSession("other");
  expect(await session2.request("hello")).toMatchInlineSnapshot(`"echo: hello"`);
  expect(await session.request("/session info --target other")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: other
    agent: test2
    agent session id: __testSession1
    updated at: <time>
    verbose: thinking
    renew: off
    active turn: no"
  `);
  expect(await session.request("/session new --target other test")).toMatchInlineSnapshot(`
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
  expect(await session2.request("hello2")).toMatchInlineSnapshot(`"echo: hello2"`);
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
  expect(await session.request("/session new --target other no-such-agent")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Unknown agent: no-such-agent"
  `);
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
});

test("removes an agent after cleaning up its stale session mapping", async () => {
  const tester = await createHandlerTester();
  const admin = tester.createSession("admin");
  const stale = tester.createSession("stale");

  expect(await admin.request(`/agent new old-agent ${TEST_AGENT_COMMAND}`)).toMatchInlineSnapshot(`
    "[⚙️ System]
    Saved new agent: old-agent"
  `);
  expect(await stale.request("/session new old-agent")).toMatchInlineSnapshot(`
    "[⚙️ System]
    New session ready."
  `);
  expect(await admin.request("/agent remove old-agent")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Cannot remove agent: old-agent
    Referenced sessions:
    - stale
      agent session id: none
      updated at: none"
  `);
  expect(await admin.request("/session info --target stale")).toMatchInlineSnapshot(`
    "[⚙️ System]
    session: stale
    agent: old-agent
    agent session id: none
    updated at: none
    verbose: thinking
    renew: off
    active turn: no"
  `);
  expect(await admin.request("/session close --target stale")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Session closed: stale."
  `);
  expect(await admin.request("/agent remove old-agent")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Removed agent: old-agent"
  `);
  expect(await admin.request("/agent list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test -> node <cwd>/src/bin/test-agent.js (default)"
  `);
});
