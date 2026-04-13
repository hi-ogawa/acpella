import fs from "node:fs";
import type { ListSessionsResponse } from "@agentclientprotocol/sdk";
import type { Context } from "grammy";
import { startAcpManager } from "./acp/index.ts";
import type { AgentSession } from "./acp/index.ts";
import type { AppConfig } from "./config.ts";
import { createSessionStateStore } from "./state.ts";

const MESSAGE_SPLIT_BUDGET = 3900;

interface StateSession {
  name: string;
  sessionId: string;
}

export interface MessageRuntimeMetadata {
  received_at: string;
  timezone: string;
  surface: "telegram";
  chat_type: "dm" | "group";
  chat_id: string;
  message_id: string;
  sender_id?: string;
}

export async function createHandler(
  config: AppConfig,
  options: {
    onServiceExit: () => void;
  },
): Promise<{
  handle: (options: { session: string; context: Context; receivedAt?: Date }) => Promise<void>;
}> {
  const manager = await startAcpManager({ command: config.agent.command, cwd: config.home });
  const state = createSessionStateStore(config);
  const activeSessions = new Map<string, AgentSession>();
  const cancelledSessions = new WeakSet<AgentSession>();

  async function handlePrompt(options: {
    context: Context;
    name: string;
    text: string;
    receivedAt: Date;
    sessionId?: string;
  }): Promise<void> {
    if (activeSessions.has(options.name)) {
      await sendSystemResponse({
        context: options.context,
        limit: MESSAGE_SPLIT_BUDGET,
        text: "Agent turn already in progress. Send /cancel to stop it.",
      });
      return;
    }

    const session = options.sessionId
      ? await manager.loadSession({
          sessionCwd: config.home,
          sessionId: options.sessionId,
        })
      : await manager.newSession({ sessionCwd: config.home });

    try {
      const customPrompt = !options.sessionId
        ? readOptionalPromptFile(config.prompt.file)
        : undefined;
      const userText = formatPromptWithMessageMetadata({
        metadata: buildMessageRuntimeMetadata({
          context: options.context,
          receivedAt: options.receivedAt,
        }),
        userText: options.text,
      });
      const promptText = customPrompt ? formatFirstPrompt({ customPrompt, userText }) : userText;

      const { queue } = session.prompt(promptText);
      const responseWriter = createResponseWriter({
        context: options.context,
        limit: MESSAGE_SPLIT_BUDGET,
      });
      activeSessions.set(options.name, session);

      for await (const update of queue) {
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
          await responseWriter.write(update.content.text);
        } else if (update.sessionUpdate === "tool_call") {
          console.log(`[acp:update] tool_call: ${update.title}`);
          await responseWriter.flush();
          await responseWriter.write(`Tool: ${update.title}`);
          await responseWriter.flush();
        } else {
          console.log(`[acp:update] ${update.sessionUpdate}`);
        }
      }
      if (cancelledSessions.has(session)) {
        await responseWriter.flush();
        await sendSystemResponse({
          context: options.context,
          limit: MESSAGE_SPLIT_BUDGET,
          text: "Agent turn cancelled.",
        });
        return;
      }
      await responseWriter.finish();
      if (!options.sessionId) {
        state.setSessionId(options.name, session.sessionId);
      }
    } finally {
      if (activeSessions.get(options.name) === session) {
        activeSessions.delete(options.name);
      }
      session.close();
    }
  }

  async function handleCancel(options: { context: Context; sessionName: string }): Promise<void> {
    const session = activeSessions.get(options.sessionName);
    if (!session) {
      await sendSystemResponse({
        context: options.context,
        limit: MESSAGE_SPLIT_BUDGET,
        text: "No active agent turn.",
      });
      return;
    }

    cancelledSessions.add(session);
    let response = "Cancelled current agent turn.";
    try {
      await session.cancel();
    } catch (e) {
      console.error("[acp] cancel failed, killing agent process:", e);
      session.close();
      response = "Cancelled current agent turn by killing the agent process.";
    }
    await sendSystemResponse({
      context: options.context,
      limit: MESSAGE_SPLIT_BUDGET,
      text: response,
    });
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
    receivedAt: Date;
  }): Promise<void> {
    return handlePrompt({
      context: options.context,
      name: options.name,
      text: options.text,
      receivedAt: options.receivedAt,
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
    return `\
session: ${options.name}
agent: ${config.agent.alias}
session id: ${state.getSessionId(options.name) ?? "none"}`;
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

    return `\
state sessions (${stateSessions.length}):
${formatStateSessions(stateSessions).join("\n")}

agent sessions (${agentSessions.sessions.length}):
${formatAgentSessions(agentSessions).join("\n")}

state missing in agent (${missingInAgent.length}):
${formatStateSessions(missingInAgent).join("\n")}

agent not tracked by state (${untrackedAgentSessions.length}):
${formatAgentSessions({ sessions: untrackedAgentSessions }).join("\n")}`;
  }

  async function handleSessionCommand(options: {
    context: Context;
    text: string;
    sessionName: string;
    receivedAt: Date;
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
          receivedAt: options.receivedAt,
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
        response = `\
Usage:
/session
/session list
/session new
/session load <sessionId>
/session close [sessionId]`;
    }
    await sendSystemResponse({
      context: options.context,
      limit: MESSAGE_SPLIT_BUDGET,
      text: response,
    });
    return true;
  }

  async function handleServiceCommand(commandOptions: {
    context: Context;
    text: string;
  }): Promise<boolean> {
    const [command, subcommand] = commandOptions.text.trim().split(/\s+/);
    if (command !== "/service") {
      return false;
    }
    if (subcommand === "exit") {
      await sendSystemResponse({
        context: commandOptions.context,
        limit: MESSAGE_SPLIT_BUDGET,
        text: "Exiting acpella.",
      });
      options.onServiceExit();
      return true;
    }
    await sendSystemResponse({
      context: commandOptions.context,
      limit: MESSAGE_SPLIT_BUDGET,
      text: "Usage: /service exit",
    });
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

  const handle = async (options: {
    session: string;
    context: Context;
    receivedAt?: Date;
  }): Promise<void> => {
    const text = options.context.message!.text!;
    const sessionName = options.session;
    const receivedAt = options.receivedAt ?? new Date();

    if (text === "/status") {
      await sendSystemResponse({
        context: options.context,
        limit: MESSAGE_SPLIT_BUDGET,
        text: handleStatus(),
      });
      return;
    }
    if (text === "/cancel") {
      await handleCancel({
        context: options.context,
        sessionName,
      });
      return;
    }
    const handledServiceCommand = await handleServiceCommand({
      context: options.context,
      text,
    });
    if (handledServiceCommand) {
      return;
    }
    const handledSessionCommand = await handleSessionCommand({
      context: options.context,
      text,
      sessionName,
      receivedAt,
    });
    if (handledSessionCommand) {
      return;
    }

    await handlePrompt({
      context: options.context,
      name: sessionName,
      text,
      receivedAt,
      sessionId: state.getSessionId(sessionName),
    });
  };

  return { handle };
}

export function buildMessageRuntimeMetadata(options: {
  context: Context;
  receivedAt: Date;
}): MessageRuntimeMetadata {
  const chatType = options.context.chat?.type === "private" ? "dm" : "group";
  const senderId = options.context.from?.id;
  return {
    received_at: formatLocalIsoWithOffset(options.receivedAt),
    timezone: resolveRuntimeTimezone(),
    surface: "telegram",
    chat_type: chatType,
    chat_id: String(options.context.chat?.id ?? "unknown"),
    message_id: String(options.context.message?.message_id ?? "unknown"),
    ...(senderId !== undefined ? { sender_id: String(senderId) } : {}),
  };
}

export function formatPromptWithMessageMetadata(options: {
  metadata: MessageRuntimeMetadata;
  userText: string;
}): string {
  const metadataLines = Object.entries(options.metadata).map(([key, value]) => `${key}: ${value}`);
  return `\
<message_metadata>
${metadataLines.join("\n")}
</message_metadata>

${options.userText}`;
}

function formatLocalIsoWithOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absOffset / 60);
  const offsetRemainderMinutes = absOffset % 60;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}${sign}${pad2(
    offsetHours,
  )}:${pad2(offsetRemainderMinutes)}`;
}

function resolveRuntimeTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
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

function readOptionalPromptFile(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function sendTextResponse(options: {
  context: Context;
  limit: number;
  text: string;
}): Promise<void> {
  const parts = splitMessageText(options.text, options.limit);
  for (const part of parts) {
    await options.context.reply(part);
  }
}

async function sendSystemResponse(options: {
  context: Context;
  limit: number;
  text: string;
}): Promise<void> {
  await sendTextResponse({
    context: options.context,
    limit: options.limit,
    text: `⚙️ ${options.text}`,
  });
}

function splitMessageText(text: string, limit: number): string[] {
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    const result = splitHead(remaining, limit);
    const part = result.head.trim();
    if (part) {
      parts.push(part);
    }
    remaining = result.tail.trim();
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

function createResponseWriter(options: { context: Context; limit: number }) {
  let bufferedText = "";
  let sentResponse = false;

  async function send(text: string): Promise<void> {
    await sendTextResponse({
      context: options.context,
      limit: options.limit,
      text,
    });
    sentResponse = true;
  }

  async function flush(): Promise<void> {
    if (!bufferedText.trim()) {
      bufferedText = "";
      return;
    }
    await send(bufferedText);
    bufferedText = "";
  }

  async function flushOversizedText(): Promise<void> {
    while (bufferedText.length > options.limit) {
      const result = splitHead(bufferedText, options.limit);
      bufferedText = result.tail;
      const part = result.head.trim();
      if (part) {
        await send(part);
      }
    }
  }

  return {
    async write(text: string): Promise<void> {
      bufferedText += text;
      await flushOversizedText();
    },
    flush,
    async finish(): Promise<void> {
      await flush();
      if (!sentResponse) {
        await options.context.reply("(no response)");
      }
    },
  };
}

function splitHead(text: string, limit: number): { head: string; tail: string } {
  const splitIndex = findSplitIndex(text, limit);
  return {
    head: text.slice(0, splitIndex),
    tail: text.slice(splitIndex),
  };
}
