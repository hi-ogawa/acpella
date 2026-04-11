import fs from "node:fs/promises";
import path from "node:path";
import { startAcpManager, type AcpSession } from "./acp/index.ts";

export interface HandlerConfig {
  agent: string;
  cwd: string;
}

const AGENT_MAP = {
  codex: path.join(
    import.meta.dirname,
    "..",
    "node_modules/@zed-industries/codex-acp/bin/codex-acp.js",
  ),
};

export async function createHandler(): Promise<{
  handle: (text: string, session: string) => Promise<string>;
  config: HandlerConfig;
}> {
  const resolved: HandlerConfig = {
    agent: process.env.ACPELLA_AGENT ?? AGENT_MAP.codex,
    cwd: process.env.ACPELLA_HOME ?? process.cwd(),
  };

  const manager = await startAcpManager({ command: resolved.agent, cwd: resolved.cwd });
  const sessions = new Map<string, AcpSession>();

  // TODO: support jsonc
  // TODO: use generic config util
  const stateFile = path.join(resolved.cwd, "acpella.json");

  async function readState(): Promise<Record<string, string>> {
    try {
      const raw = await fs.readFile(stateFile, "utf8");
      return JSON.parse(raw) as Record<string, string>;
    } catch (e) {
      console.error("[acp] readState failed:", e);
      return {};
    }
  }

  async function writeState(state: Record<string, string>): Promise<void> {
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
  }

  async function ensureSession(name: string): Promise<AcpSession> {
    const existing = sessions.get(name);
    if (existing) {
      return existing;
    }
    const state = await readState();
    const persistedId = state[name];
    if (persistedId) {
      try {
        const session = await manager.loadSession({
          sessionCwd: resolved.cwd,
          sessionId: persistedId,
        });
        sessions.set(name, session);
        return session;
      } catch (e) {
        console.error("[acp] loadSession failed, creating new session:", e);
      }
    }
    const session = await manager.newSession({ sessionCwd: resolved.cwd });
    sessions.set(name, session);
    await writeState({ ...state, [name]: session.sessionId });
    return session;
  }

  async function removeSession(name: string): Promise<void> {
    const state = await readState();
    const sessionId = sessions.get(name)?.sessionId ?? state[name];
    sessions.get(name)?.close();
    sessions.delete(name);
    if (sessionId) {
      try {
        await manager.closeSession({ sessionId });
      } catch (e) {
        console.error("[acp] closeSession failed:", e);
      }
    }
    if (name in state) {
      const { [name]: _, ...rest } = state;
      await writeState(rest);
    }
  }

  const handle = async (text: string, sessionName: string): Promise<string> => {
    if (text === "/status") {
      const response = [
        "daemon state: running",
        `configured agent: ${resolved.agent}`,
        `working directory: ${resolved.cwd}`,
      ].join("\n");
      return response;
    }
    if (text === "/reset") {
      await removeSession(sessionName);
      return "Session reset. Next message will start a fresh session.";
    }

    const session = await ensureSession(sessionName);
    const { queue } = session.prompt(text);

    // TODO: stream and split as needed
    const texts: string[] = [];
    for await (const update of queue) {
      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
        texts.push(update.content.text);
      } else if (update.sessionUpdate === "tool_call") {
        console.log(`[acp:update] tool_call: ${update.title}`);
      } else {
        console.log(`[acp:update] ${update.sessionUpdate}`);
      }
    }
    return texts.join("") || "(no response)";
  };

  return { handle, config: resolved };
}
