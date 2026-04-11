import { describe, it, expect, onTestFinished } from "vitest";
import { startAcpManager } from "./index.ts";
import path from "node:path";

// TODO: test
// - multiple updates per prompt
// - load session

describe(startAcpManager, () => {
  it("basic", async () => {
    const manager = await startAcpManager({
      command: "node src/test-agent.ts",
      cwd: path.join(import.meta.dirname, "../.."),
    });
    const session = await manager.newSession();
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
    const manager = await startAcpManager({
      command: "node src/test-agent.ts",
      cwd: path.join(import.meta.dirname, "../.."),
    });
    const session = await manager.loadSession({
      sessionId: "__testLoadSession",
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
  });
});

async function arrayFromAsyncIterator<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iter) {
    result.push(item);
  }
  return result;
}
