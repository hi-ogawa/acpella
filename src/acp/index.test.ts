import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, onTestFinished } from "vitest";
import { startAcpManager } from "./index.ts";

describe(startAcpManager, () => {
  it("basic", async () => {
    const home = createTempHome();
    const manager = await startAcpManager({
      command: getTestAgentCommand(),
      cwd: home,
    });
    const session = await manager.newSession({
      sessionCwd: home,
    });
    onTestFinished(() => session.close());

    const result = session.prompt("hello");
    const updates = await arrayFromAsyncIterator(result.queue);
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
    const home = createTempHome();
    const manager = await startAcpManager({
      command: getTestAgentCommand(),
      cwd: home,
    });
    const newSession = await manager.newSession({
      sessionCwd: home,
    });
    onTestFinished(() => newSession.close());

    const listedSessions = await manager.listSessions();
    expect(listedSessions).toEqual({
      sessions: [{ sessionId: "__testSession1", cwd: home }],
    });

    const session = await manager.loadSession({
      sessionId: "__testSession1",
      sessionCwd: home,
    });
    onTestFinished(() => session.close());

    const result = session.prompt("world");
    const updates = await arrayFromAsyncIterator(result.queue);
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

function createTempHome(): string {
  const home = path.join(import.meta.dirname, `../../.tmp/test-acp-${crypto.randomUUID()}`);
  fs.mkdirSync(home, { recursive: true });
  onTestFinished(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });
  return home;
}

function getTestAgentCommand(): string {
  return `node ${path.join(import.meta.dirname, "../lib/test-agent.ts")}`;
}

async function arrayFromAsyncIterator<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iter) {
    result.push(item);
  }
  return result;
}
