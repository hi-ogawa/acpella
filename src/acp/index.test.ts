import { describe, it, expect } from "vitest";
import { startAcpAgent } from "./index.ts";
import path from "node:path";

describe(startAcpAgent, () => {
  it("round-trip prompt with echo agent", async () => {
    const agent = await startAcpAgent({
      command: "node src/test-agent.ts",
      cwd: path.join(import.meta.dirname, "../.."),
    });
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
