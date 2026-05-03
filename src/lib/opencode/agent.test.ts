import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { expect, it, onTestFinished, vi } from "vitest";
import { arrayFromAsyncIterator, useFs } from "../../test/helper.ts";
import { AgentManager } from "../acp/index.ts";

vi.setConfig({
  testTimeout: 20000,
});

const execFileAsync = promisify(execFile);
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

it("stops the opencode server child process when the adapter stops", async () => {
  const { root } = useFs({ prefix: "opencode-acp-cleanup" });
  const manager = new AgentManager({
    command: OPENCODE_ACP_COMMAND,
    cwd: root,
  });

  const session = await manager.newSession({ sessionCwd: root });
  onTestFinished(() => session.stop());

  const serverPid = await findChildOpencodeServePid(session.agent.child.pid!);
  session.stop();

  await expect.poll(() => processExists(serverPid)).toBe(false);
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

async function findChildOpencodeServePid(parentPid: number): Promise<number> {
  const { stdout } = await execFileAsync("pgrep", [
    "-P",
    String(parentPid),
    "-f",
    "opencode serve",
  ]);

  const pids = stdout.trim().split(/\s+/).filter(Boolean).map(Number);

  if (pids.length !== 1) {
    throw new Error(`expected one child opencode serve process for ${parentPid}, found: ${stdout}`);
  }

  return pids[0]!;
}

async function processExists(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
