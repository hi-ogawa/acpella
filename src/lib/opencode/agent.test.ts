import { fileURLToPath } from "node:url";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { expect, it, onTestFinished, vi } from "vitest";
import { arrayFromAsyncIterator, useFs } from "../../test/helper.ts";
import { AgentManager } from "../acp/index.ts";

vi.setConfig({
  testTimeout: 20000,
});

const OPENCODE_ACP_COMMAND = `node ${fileURLToPath(import.meta.resolve("#opencode-acp"))}`;

it("newSession and prompt", async () => {
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
  expect(textFromUpdates(updates).toLowerCase()).toContain("ok");
  if (updates.length < 1) {
    throw new Error("expected at least one text agent_message_chunk");
  }

  await manager.closeSession({ sessionId: session.sessionId });
});

it("loadSession", async () => {
  const { root } = useFs({ prefix: "opencode-acp-load" });
  const manager = new AgentManager({
    command: OPENCODE_ACP_COMMAND,
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

function textFromUpdates(updates: SessionUpdate[]) {
  return updates
    .map((update) => {
      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
        return update.content.text;
      }
      return "";
    })
    .join("");
}
