import fs from "node:fs";
import { startAcpManager } from "./acp/index.ts";
import type { AgentSession } from "./acp/index.ts";
import type { AppConfig } from "./config.ts";
import { createReply, MESSAGE_SPLIT_BUDGET } from "./lib/reply.ts";
import type { Reply, ReplyContext } from "./lib/reply.ts";
import { createSessionStateStore } from "./state.ts";
import type { StateSession } from "./state.ts";

interface Handler {
  handle: (options: { session: string; context: HandlerContext }) => Promise<void>;
}

export interface HandlerContext extends ReplyContext {
  message?: {
    text?: string;
  };
}

export async function createHandler(
  config: AppConfig,
  options: {
    version?: string;
    onServiceExit: () => void;
  },
): Promise<Handler> {
  const manager = await startAcpManager({ command: config.agent.command, cwd: config.home });
  const state = createSessionStateStore(config);
  const activeSessions = new Map<string, AgentSession>();
  const cancelledSessions = new WeakSet<AgentSession>();

  async function handlePrompt(options: {
    reply: Reply;
    name: string;
    text: string;
    stateSession?: StateSession;
  }): Promise<void> {
    const { reply, stateSession } = options;
    if (activeSessions.has(options.name)) {
      await reply.system("Agent turn already in progress. Send /cancel to stop it.");
      return;
    }

    const verbose = stateSession?.verbose ?? true;
    const sessionId = stateSession?.sessionId;
    const session = sessionId
      ? await manager.loadSession({
          sessionCwd: config.home,
          sessionId,
        })
      : await manager.newSession({ sessionCwd: config.home });

    try {
      const customPrompt = !sessionId ? readOptionalPromptFile(config.prompt.file) : undefined;
      const promptText = customPrompt
        ? formatFirstPrompt({ customPrompt, userText: options.text })
        : options.text;

      const { queue } = session.prompt(promptText);
      activeSessions.set(options.name, session);

      for await (const update of queue) {
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
          await reply.write(update.content.text);
        } else if (update.sessionUpdate === "tool_call") {
          console.log(`[acp:update] tool_call: ${update.title}`);
          if (verbose) {
            await reply.flush();
            await reply.write(`Tool: ${update.title}`);
            await reply.flush();
          }
        } else {
          console.log(`[acp:update] ${update.sessionUpdate}`);
        }
      }
      if (cancelledSessions.has(session)) {
        await reply.flush();
        await reply.system("Agent turn cancelled.");
        return;
      }
      await reply.finish();
      if (!sessionId) {
        state.setSession(options.name, { sessionId: session.sessionId });
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
      await options.reply.system("No active agent turn.");
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
    await options.reply.system(response);
  }

  async function handleCloseSession(options: {
    name: string;
    sessionIdArg?: string;
  }): Promise<void> {
    const currentSessionId = state.getSession(options.name)?.sessionId;
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
      state.setSession(options.name, { sessionId: session.sessionId });
      return `Loaded session: ${session.sessionId}`;
    } finally {
      session.close();
    }
  }

  function handleCurrentSession(options: { name: string }): string {
    return `\
session: ${options.name}
agent: ${config.agent.alias}
session id: ${state.getSession(options.name)?.sessionId ?? "none"}`;
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
    await options.reply.system(response);
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
      await commandOptions.reply.system("Exiting acpella.");
      options.onServiceExit();
      return true;
    }
    await commandOptions.reply.system("Usage: /service exit");
    return true;
  }

  function handleStatus(): string {
    return `\
status: running
version: ${options.version ?? "(unknown)"}
agent: ${config.agent.command}
home: ${config.home}
`;
  }

  const handle: Handler["handle"] = async (options) => {
    const text = options.context.message!.text!;
    const sessionName = options.session;
    const reply = createReply({
      context: options.context,
      limit: MESSAGE_SPLIT_BUDGET,
    });

    if (text === "/status") {
      await reply.system(handleStatus());
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
      stateSession: state.getSession(sessionName),
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
