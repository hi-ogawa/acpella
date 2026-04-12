import { startAcpManager } from "./acp/index.ts";
import type { AppConfig } from "./config.ts";
import { createSessionStateStore } from "./state.ts";

export function formatStatus(config: AppConfig): string {
  return [
    "service state: running",
    `configured agent: ${config.agent.alias}`,
    `agent command: ${config.agent.command}`,
    `home: ${config.home}`,
    `state file: ${config.stateFile}`,
  ].join("\n");
}

export async function createHandler(config: AppConfig): Promise<{
  handle: (text: string, session: string) => Promise<string>;
}> {
  const manager = await startAcpManager({ command: config.agent.command, cwd: config.home });
  const state = createSessionStateStore(config);

  async function promptSession(name: string, text: string): Promise<string> {
    const persistedId = state.getSessionId(name);
    const isNewSession = !persistedId;
    const session = persistedId
      ? await manager.loadSession({
          sessionCwd: config.home,
          sessionId: persistedId,
        })
      : await manager.newSession({ sessionCwd: config.home });

    try {
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
      if (isNewSession) {
        state.setSessionId(name, session.sessionId);
      }
      return texts.join("") || "(no response)";
    } finally {
      session.close();
    }
  }

  async function removeSession(name: string): Promise<void> {
    const sessionId = state.getSessionId(name);
    if (sessionId) {
      try {
        await manager.closeSession({ sessionId });
      } catch (e) {
        console.error("[acp] closeSession failed:", e);
      }
    }
    state.deleteSession(name);
  }

  const handle = async (text: string, sessionName: string): Promise<string> => {
    if (text === "/status") {
      return formatStatus(config);
    }
    if (text === "/reset") {
      await removeSession(sessionName);
      return "Session reset. Next message will start a fresh session.";
    }

    return promptSession(sessionName, text);
  };

  return { handle };
}
