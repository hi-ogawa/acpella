import type { ListSessionsResponse } from "@agentclientprotocol/sdk";
import { startAcpManager } from "./acp/index.ts";
import type { AppConfig } from "./config.ts";
import { createSessionStateStore } from "./state.ts";

interface StateSession {
  name: string;
  sessionId: string;
}

export async function createHandler(config: AppConfig): Promise<{
  handle: (text: string, session: string) => Promise<string>;
}> {
  const manager = await startAcpManager({ command: config.agent.command, cwd: config.home });
  const state = createSessionStateStore(config);

  async function handlePrompt(options: {
    name: string;
    text: string;
    sessionId?: string;
  }): Promise<string> {
    const session = options.sessionId
      ? await manager.loadSession({
          sessionCwd: config.home,
          sessionId: options.sessionId,
        })
      : await manager.newSession({ sessionCwd: config.home });
    const promptText =
      !options.sessionId && config.prompt.text
        ? formatFirstPrompt({ customPrompt: config.prompt.text, userText: options.text })
        : options.text;

    try {
      // TODO: stream and split as needed
      const { queue } = session.prompt(promptText);
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
      if (!options.sessionId) {
        state.setSessionId(options.name, session.sessionId);
      }
      return texts.join("") || "(no response)";
    } finally {
      session.close();
    }
  }

  async function handleCloseSession(name: string, sessionIdArg?: string): Promise<void> {
    const currentSessionId = state.getSessionId(name);
    const sessionId = sessionIdArg ?? currentSessionId;
    if (sessionId) {
      try {
        await manager.closeSession({ sessionId });
      } catch (e) {
        console.error("[acp] closeSession failed:", e);
      }
    }
    if (!sessionIdArg || sessionIdArg === currentSessionId) {
      state.deleteSession(name);
    }
  }

  async function handleNewSession(name: string, text: string): Promise<string> {
    return handlePrompt({
      name,
      text,
    });
  }

  async function handleLoadSession(name: string, sessionId: string | undefined): Promise<string> {
    if (!sessionId) {
      return "Usage: /session load <sessionId>";
    }
    const session = await manager.loadSession({ sessionCwd: config.home, sessionId });
    try {
      state.setSessionId(name, session.sessionId);
      return `Loaded session: ${session.sessionId}`;
    } finally {
      session.close();
    }
  }

  function handleCurrentSession(name: string): string {
    return [
      `session: ${name}`,
      `agent: ${config.agent.alias}`,
      `session id: ${state.getSessionId(name) ?? "none"}`,
    ].join("\n");
  }

  async function handleListSessions(): Promise<string> {
    const stateSessions = state.listSessions();
    const agentSessions = await manager.listSessions();
    const agentSessionIds = new Set(agentSessions.sessions.map((session) => session.sessionId));
    const stateSessionIds = new Set(stateSessions.map((session) => session.sessionId));
    const missingInAgent = stateSessions.filter(
      (session) => !agentSessionIds.has(session.sessionId),
    );
    const untrackedAgentSessions = agentSessions.sessions.filter(
      (session) => !stateSessionIds.has(session.sessionId),
    );

    return [
      `state sessions (${stateSessions.length}):`,
      ...formatStateSessions(stateSessions),
      "",
      `agent sessions (${agentSessions.sessions.length}):`,
      ...formatAgentSessions(agentSessions),
      "",
      `state missing in agent (${missingInAgent.length}):`,
      ...formatStateSessions(missingInAgent),
      "",
      `agent not tracked by state (${untrackedAgentSessions.length}):`,
      ...formatAgentSessions({ sessions: untrackedAgentSessions }),
    ].join("\n");
  }

  async function handleSessionCommand(
    text: string,
    sessionName: string,
  ): Promise<string | undefined> {
    const [command, subcommand, ...args] = text.trim().split(/\s+/);
    if (command !== "/session") {
      return undefined;
    }
    switch (subcommand) {
      case undefined:
        return handleCurrentSession(sessionName);
      case "list":
        return handleListSessions();
      case "new":
        return handleNewSession(sessionName, args.join(" "));
      case "load":
        return handleLoadSession(sessionName, args[0]);
      case "close":
        await handleCloseSession(sessionName, args[0]);
        return "Session closed. Next message will start a fresh session.";
      default:
        return [
          "Usage:",
          "/session",
          "/session list",
          "/session new",
          "/session load <sessionId>",
          "/session close [sessionId]",
        ].join("\n");
    }
  }

  function handleStatus(): string {
    return `\
service state: running
configured agent: ${config.agent.alias}
agent command: ${config.agent.command}
home: ${config.home}
state file: ${config.stateFile}
prompt file: ${config.prompt.file ?? "none"}`;
  }

  const handle = async (text: string, sessionName: string): Promise<string> => {
    if (text === "/status") {
      return handleStatus();
    }
    const sessionCommandResponse = await handleSessionCommand(text, sessionName);
    if (sessionCommandResponse) {
      return sessionCommandResponse;
    }

    return handlePrompt({
      name: sessionName,
      text,
      sessionId: state.getSessionId(sessionName),
    });
  };

  return { handle };
}

function formatStateSessions(sessions: StateSession[]): string[] {
  if (sessions.length === 0) {
    return ["- none"];
  }
  return sessions.map((session) => `- ${session.name} -> ${session.sessionId}`);
}

function formatAgentSessions(response: Pick<ListSessionsResponse, "sessions">): string[] {
  if (response.sessions.length === 0) {
    return ["- none"];
  }
  return response.sessions.map((session) =>
    [
      `- ${session.sessionId}`,
      `cwd=${session.cwd}`,
      session.title ? `title=${session.title}` : undefined,
      session.updatedAt ? `updatedAt=${session.updatedAt}` : undefined,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function formatFirstPrompt(options: { customPrompt: string; userText: string }): string {
  return `\
Use these additional instructions for this session:

<custom_instructions>
${options.customPrompt.trim()}
</custom_instructions>

${options.userText}`;
}
