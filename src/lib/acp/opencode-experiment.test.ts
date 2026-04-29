import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { useFs } from "../../test/helper.ts";
import { AgentManager } from "./index.ts";

const OPENCODE_EXPERIMENT_AGENT_COMMAND = `node ${path.join(
  import.meta.dirname,
  "../../../experiments/opencode-acp-agent/agent.ts",
)}`;

describe("OpenCode experimental ACP agent", () => {
  it("supports the basic ACP session and prompt shape", async () => {
    const { root } = useFs({ prefix: "opencode-acp" });
    const manager = new AgentManager({
      command: OPENCODE_EXPERIMENT_AGENT_COMMAND,
      cwd: root,
    });

    const session = await manager.newSession({ sessionCwd: root });
    onTestFinished(() => session.stop());

    await expect(manager.listSessions()).resolves.toEqual({
      sessions: [{ sessionId: "opencode-experiment-1", cwd: root }],
    });

    const result = session.prompt("hello");
    const updates = await arrayFromAsyncIterator(result.consume());
    await expect(result.promise).resolves.toEqual({ stopReason: "end_turn" });
    expect(updates).toEqual([
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "opencode-experiment echo: hello" },
      },
    ]);

    await manager.closeSession({ sessionId: "opencode-experiment-1" });
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
