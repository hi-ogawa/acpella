import fs from "node:fs";
import type { Context } from "grammy";
import { startAcpManager } from "./acp/index.ts";
import type { AgentSession } from "./acp/index.ts";
import type { AppConfig } from "./config.ts";
import { createSessionStateStore } from "./state.ts";

const MESSAGE_SPLIT_BUDGET = 3900;

interface Reply {
  send: (text: string, options?: { system?: boolean }) => Promise<void>;
  stream: () => ResponseWriter;
}

interface ResponseWriter {
  write: (text: string) => Promise<void>;
  flush: () => Promise<void>;
  finish: () => Promise<void>;
}

export async function createHandler(
  config: AppConfig,
  options: {
    onServiceExit: () => void;
  },
): Promise<{
  handle: (options: { session: string; context: Context }) => Promise<void>;
}> {
  const manager = await startAcpManager({ command: config.agent.command, cwd: config.home });
  const state = createSessionStateStore(config);
  const activeSessions = new Map<string, AgentSession>();
  const cancelledSessions = new WeakSet<AgentSession>();

  async function handlePrompt(options: {
    reply: Reply;
    name: string;
    text: string;
    sessionId?: string;
  }): Promise<void> {
    if (activeSessions.has(options.name)) {
      await options.reply.send("Agent turn already in progress. Send /cancel to stop it.", {
        system: true,
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
      const promptText = customPrompt
        ? formatFirstPrompt({ customPrompt, userText: options.text })
        : options.text;

      const { queue } = session.prompt(promptText);
      const responseWriter = options.reply.stream();
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
        await options.reply.send("Agent turn cancelled.", { system: true });
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

  async function handleCancel(options: { reply: Reply; sessionName: string }): Promise<void> {
    const session = activeSessions.get(options.sessionName);
    if (!session) {
      await options.reply.send("No active agent turn.", { system: true });
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
    await options.reply.send(response, { system: true });
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
    reply: Reply;
    name: string;
    text: string;
  }): Promise<void> {
    return handlePrompt({
      reply: options.reply,
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
    return `\
session: ${options.name}
agent: ${config.agent.alias}
session id: ${state.getSessionId(options.name) ?? "none"}`;
  }

  async function handleListSessions(): Promise<string> {
    const stateSessions = state.getSessions();
    const agentSessions = await manager.listSessions();
    const agentSessionIds = new Set(agentSessions.sessions.map((session) => session.sessionId));
    const stateSessionIds = new Set(Object.values(stateSessions).map((entry) => entry.sessionId));
    let output = "";
    for (const [name, entry] of Object.entries(stateSessions)) {
      output += `- ${name} -> ${entry.sessionId}`;
      if (agentSessionIds.has(entry.sessionId)) {
        output += " (active)";
      } else {
        output += " (not active)";
      }
      output += "\n";
    }
    for (const session of agentSessions.sessions) {
      if (!stateSessionIds.has(session.sessionId)) {
        output += `- (unknown) -> ${session.sessionId} (active)\n`;
      }
    }
    return output || "No sessions.";
  }

  async function handleSessionCommand(options: {
    reply: Reply;
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
          reply: options.reply,
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
        response = `\
Usage:
/session
/session list
/session new
/session load <sessionId>
/session close [sessionId]`;
    }
    await options.reply.send(response, { system: true });
    return true;
  }

  async function handleServiceCommand(commandOptions: {
    reply: Reply;
    text: string;
  }): Promise<boolean> {
    const [command, subcommand] = commandOptions.text.trim().split(/\s+/);
    if (command !== "/service") {
      return false;
    }
    if (subcommand === "exit") {
      await commandOptions.reply.send("Exiting acpella.", { system: true });
      options.onServiceExit();
      return true;
    }
    await commandOptions.reply.send("Usage: /service exit", { system: true });
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
    const reply = createReply({
      context: options.context,
      limit: MESSAGE_SPLIT_BUDGET,
    });

    if (text === "/status") {
      await reply.send(handleStatus(), { system: true });
      return;
    }
    if (text === "/cancel") {
      await handleCancel({
        reply,
        sessionName,
      });
      return;
    }
    const handledServiceCommand = await handleServiceCommand({
      reply,
      text,
    });
    if (handledServiceCommand) {
      return;
    }
    const handledSessionCommand = await handleSessionCommand({
      reply,
      text,
      sessionName,
    });
    if (handledSessionCommand) {
      return;
    }

    await handlePrompt({
      reply,
      name: sessionName,
      text,
      sessionId: state.getSessionId(sessionName),
    });
  };

  return { handle };
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

function createReply(options: { context: Context; limit: number }): Reply {
  async function send(text: string, sendOptions: { system?: boolean } = {}): Promise<void> {
    const responseText = sendOptions.system ? `⚙️ ${text}` : text;
    const parts = splitMessageText(responseText, options.limit);
    for (const part of parts) {
      await options.context.reply(part);
    }
  }

  return {
    send,
    stream() {
      return createResponseWriter({
        limit: options.limit,
        send,
      });
    },
  };
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

function createResponseWriter(options: {
  limit: number;
  send: (text: string) => Promise<void>;
}): ResponseWriter {
  let bufferedText = "";
  let sentResponse = false;

  async function send(text: string): Promise<void> {
    await options.send(text);
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
        await send("(no response)");
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
