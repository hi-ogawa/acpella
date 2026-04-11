import { describe, it, expect } from "vitest";
import { startAcpManager } from "./index.ts";
import path from "node:path";

// TODO: test
// - multiple updates per prompt
// - load session

describe(startAcpManager, () => {
  it("round-trip prompt with echo agent", async () => {
    const manager = await startAcpManager({
      command: "node src/test-agent.ts",
      cwd: path.join(import.meta.dirname, "../.."),
    });
    const agent = await manager.newSession();
    const result = agent.prompt("hello");
    const updates: unknown[] = [];
    for await (const update of result.queue) {
      updates.push(update);
    }
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
});
