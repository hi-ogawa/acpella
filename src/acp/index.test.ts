import { describe, it, expect, onTestFinished } from "vitest";
import { TEST_AGENT_COMMAND } from "../state.ts";
import { useFs } from "../test/helper.ts";
import { startAcpManager } from "./index.ts";

describe(startAcpManager, () => {
  it("basic", async () => {
    const { root } = useFs({ prefix: "acp" });
    const manager = await startAcpManager({
      command: TEST_AGENT_COMMAND,
      cwd: root,
    });
    const session = await manager.newSession({
      sessionCwd: root,
    });
    onTestFinished(() => session.stop());

    const result = session.prompt("hello");
    const updates = await arrayFromAsyncIterator(result.updates);
    expect(updates).toMatchInlineSnapshot(`
      [
        {
          "content": {
            "text": "echo: hello",
            "type": "text",
          },
          "sessionUpdate": "agent_message_chunk",
        },
      ]
    `);
  });

  it("loadSession", async () => {
    const { root } = useFs({ prefix: "acp" });
    const manager = await startAcpManager({
      command: TEST_AGENT_COMMAND,
      cwd: root,
    });
    const newSession = await manager.newSession({
      sessionCwd: root,
    });
    onTestFinished(() => newSession.stop());

    const listedSessions = await manager.listSessions();
    expect(listedSessions).toEqual({
      sessions: [{ sessionId: "__testSession1", cwd: root }],
    });

    const session = await manager.loadSession({
      sessionId: "__testSession1",
      sessionCwd: root,
    });
    onTestFinished(() => session.stop());

    const result = session.prompt("world");
    const updates = await arrayFromAsyncIterator(result.updates);
    expect(updates).toMatchInlineSnapshot(`
      [
        {
          "content": {
            "text": "echo: world",
            "type": "text",
          },
          "sessionUpdate": "agent_message_chunk",
        },
      ]
    `);

    await manager.closeSession({ sessionId: "__testSession1" });
    await expect(manager.listSessions()).resolves.toEqual({ sessions: [] });
  });
});

async function arrayFromAsyncIterator<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iter) {
    result.push(item);
  }
  return result;
}
