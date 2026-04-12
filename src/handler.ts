import type { ListSessionsResponse } from "@agentclientprotocol/sdk";
import type { Context } from "grammy";
import { startAcpManager } from "./acp/index.ts";
import type { AppConfig } from "./config.ts";
import { createSessionStateStore } from "./state.ts";

const MESSAGE_SPLIT_BUDGET = 3900;

interface StateSession {
  name: string;
  sessionId: string;
}

export async function createHandler(config: AppConfig): Promise<{
  handle: (options: { session: string; context: Context }) => Promise<void>;
}> {
  const manager = await startAcpManager({ command: config.agent.command, cwd: config.home });
  const state = createSessionStateStore(config);

  async function handlePrompt(options: {
    context: Context;
    name: string;
    text: string;
    sessionId?: string;
  }): Promise<void> {
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
      const { queue } = session.prompt(promptText);
      let bufferedText = "";
      let sentResponse = false;

      async function flushBufferedText(): Promise<void> {
        if (!bufferedText.trim()) {
          bufferedText = "";
          return;
        }
        await sendTextResponse(options.context, bufferedText);
        sentResponse = true;
        bufferedText = "";
      }

      async function flushOversizedText(): Promise<void> {
        while (bufferedText.length > MESSAGE_SPLIT_BUDGET) {
          const splitIndex = findSplitIndex(bufferedText, MESSAGE_SPLIT_BUDGET);
          const part = bufferedText.slice(0, splitIndex).trim();
          bufferedText = bufferedText.slice(splitIndex);
          if (part) {
            await options.context.reply(part);
            sentResponse = true;
          }
        }
      }

      for await (const update of queue) {
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
          bufferedText += update.content.text;
          await flushOversizedText();
        } else if (update.sessionUpdate === "tool_call") {
          console.log(`[acp:update] tool_call: ${update.title}`);
          await flushBufferedText();
          await sendTextResponse(options.context, `Tool: ${update.title}`);
          sentResponse = true;
        } else {
          console.log(`[acp:update] ${update.sessionUpdate}`);
        }
      }
      await flushBufferedText();
      if (!options.sessionId) {
        state.setSessionId(options.name, session.sessionId);
      }
      if (!sentResponse) {
        await options.context.reply("(no response)");
      }
    } finally {
      session.close();
    }
  }

  async function handleCloseSession(options: {
    name: string;
    sessionIdArg?: string;
  }): Promise<void> {
    const currentSessionId = state.getSessionId(options.name);
    const sessionId = options.sessionIdArg ?? currentSessionId;
    if (sessionId) {
      try {
        await manager.closeSession({ sessionId });
      } catch (e) {
        console.error("[acp] closeSession failed:", e);
      }
    }
    if (!options.sessionIdArg || options.sessionIdArg === currentSessionId) {
      state.deleteSession(options.name);
    }
  }

  async function handleNewSession(options: {
    context: Context;
    name: string;
    text: string;
  }): Promise<void> {
    return handlePrompt({
      context: options.context,
      name: options.name,
      text: options.text,
    });
  }

  async function handleLoadSession(options: { name: string; sessionId?: string }): Promise<string> {
    if (!options.sessionId) {
      return "Usage: /session load <sessionId>";
    }
    const session = await manager.loadSession({
      sessionCwd: config.home,
      sessionId: options.sessionId,
    });
    try {
      state.setSessionId(options.name, session.sessionId);
      return `Loaded session: ${session.sessionId}`;
    } finally {
      session.close();
    }
  }

  function handleCurrentSession(options: { name: string }): string {
    return [
      `session: ${options.name}`,
      `agent: ${config.agent.alias}`,
      `session id: ${state.getSessionId(options.name) ?? "none"}`,
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

  async function handleSessionCommand(options: {
    context: Context;
    text: string;
    sessionName: string;
  }): Promise<boolean> {
    const [command, subcommand, ...args] = options.text.trim().split(/\s+/);
    if (command !== "/session") {
      return false;
    }
    let response: string;
    switch (subcommand) {
      case undefined:
        response = handleCurrentSession({ name: options.sessionName });
        break;
      case "list":
        response = await handleListSessions();
        break;
      case "new":
        await handleNewSession({
          context: options.context,
          name: options.sessionName,
          text: args.join(" "),
        });
        return true;
      case "load":
        response = await handleLoadSession({
          name: options.sessionName,
          sessionId: args[0],
        });
        break;
      case "close":
        await handleCloseSession({
          name: options.sessionName,
          sessionIdArg: args[0],
        });
        response = "Session closed. Next message will start a fresh session.";
        break;
      default:
        response = [
          "Usage:",
          "/session",
          "/session list",
          "/session new",
          "/session load <sessionId>",
          "/session close [sessionId]",
        ].join("\n");
    }
    await sendTextResponse(options.context, response);
    return true;
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

  const handle = async (options: { session: string; context: Context }): Promise<void> => {
    const text = options.context.message!.text!;
    const sessionName = options.session;

    if (text === "/status") {
      await sendTextResponse(options.context, handleStatus());
      return;
    }
    const handledSessionCommand = await handleSessionCommand({
      context: options.context,
      text,
      sessionName,
    });
    if (handledSessionCommand) {
      return;
    }

    await handlePrompt({
      context: options.context,
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

${options.userText}
`;
}

async function sendTextResponse(context: Context, text: string): Promise<void> {
  const parts = splitMessageText(text, MESSAGE_SPLIT_BUDGET);
  for (const part of parts) {
    await context.reply(part);
  }
}

function splitMessageText(text: string, limit: number): string[] {
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    const splitIndex = findSplitIndex(remaining, limit);
    const part = remaining.slice(0, splitIndex).trim();
    if (part) {
      parts.push(part);
    }
    remaining = remaining.slice(splitIndex).trim();
  }
  if (remaining) {
    parts.push(remaining);
  }
  return parts;
}

function findSplitIndex(text: string, budget: number): number {
  const paragraphIndex = text.lastIndexOf("\n\n", budget);
  if (paragraphIndex > budget / 2) {
    return paragraphIndex + 2;
  }
  const lineIndex = text.lastIndexOf("\n", budget);
  if (lineIndex > budget / 2) {
    return lineIndex + 1;
  }
  const spaceIndex = text.lastIndexOf(" ", budget);
  if (spaceIndex > budget / 2) {
    return spaceIndex + 1;
  }
  return budget;
}
