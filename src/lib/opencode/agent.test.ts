import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { arrayFromAsyncIterator, useFs } from "../../test/helper.ts";
import { AgentManager } from "../acp/index.ts";

const OPENCODE_ACP_COMMAND = `node ${fileURLToPath(import.meta.resolve("#opencode-acp"))}`;

describe("OpenCode ACP agent", () => {
  it("supports the basic ACP session and prompt shape", async () => {
    const { root } = useFs({ prefix: "opencode-acp" });
    const manager = new AgentManager({
      command: OPENCODE_ACP_COMMAND,
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
        },
      ],
    });

    const result = session.prompt("Say exactly: ok");
    const updates = await arrayFromAsyncIterator(result.consume());
    await expect(result.promise).resolves.toEqual({ stopReason: "end_turn" });
    const text = updates
      .map((update) => {
        if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text") {
          return "";
        }
        return update.content.text;
      })
      .join("");
    expect(text.toLowerCase()).toContain("ok");
    if (updates.length < 1) {
      throw new Error("expected at least one text agent_message_chunk");
    }

    await manager.closeSession({ sessionId: session.sessionId });
  });
});
