import path from "node:path";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { describe, expect, it, onTestFinished } from "vitest";
import { useFs } from "../../test/helper.ts";
import { AgentManager } from "../acp/index.ts";

const OPENCODE_EXPERIMENT_AGENT_COMMAND = `node ${path.join(import.meta.dirname, "agent.ts")}`;

describe("OpenCode experimental ACP agent", () => {
  it("supports the basic ACP session and prompt shape", async () => {
    const { root } = useFs({ prefix: "opencode-acp" });
    const manager = new AgentManager({
      command: OPENCODE_EXPERIMENT_AGENT_COMMAND,
      cwd: root,
    });

    const session = await manager.newSession({ sessionCwd: root });
    onTestFinished(() => session.stop());
    expect(session.sessionId).toMatch(/^ses_/);

    await expect(manager.listSessions()).resolves.toMatchObject({
      sessions: [
        {
          sessionId: session.sessionId,
          cwd: root,
          title: "OpenCode ACP experiment",
        },
      ],
    });

    const result = session.prompt("Say exactly: ok");
    const updates = await arrayFromAsyncIterator(result.consume());
    await expect(result.promise).resolves.toEqual({ stopReason: "end_turn" });
    expect(textFromUpdates(updates).toLowerCase()).toContain("ok");
    if (updates.length < 1) {
      throw new Error("expected at least one text agent_message_chunk");
    }

    await manager.closeSession({ sessionId: session.sessionId });
  });

  it("loads an existing OpenCode session", async () => {
    const { root } = useFs({ prefix: "opencode-acp-load" });
    const manager = new AgentManager({
      command: OPENCODE_EXPERIMENT_AGENT_COMMAND,
      cwd: root,
    });

    const created = await manager.newSession({ sessionCwd: root });
    onTestFinished(() => created.stop());

    const loaded = await manager.loadSession({ sessionId: created.sessionId, sessionCwd: root });
    onTestFinished(() => loaded.stop());

    const result = loaded.prompt("Say exactly: ok");
    const updates = await arrayFromAsyncIterator(result.consume());
    await expect(result.promise).resolves.toEqual({ stopReason: "end_turn" });
    expect(textFromUpdates(updates).toLowerCase()).toContain("ok");
  });
});

function textFromUpdates(updates: SessionUpdate[]) {
  return updates
    .map((update) => {
      if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text") {
        return "";
      }
      return update.content.text;
    })
    .join("");
}

async function arrayFromAsyncIterator<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iter) {
    result.push(item);
  }
  return result;
}
