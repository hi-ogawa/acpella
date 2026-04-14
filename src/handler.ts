import fs from "node:fs";
import { startAcpManager } from "./acp/index.ts";
import type { AgentSession } from "./acp/index.ts";
import type { AppConfig } from "./config.ts";
import { createReply, MESSAGE_SPLIT_BUDGET } from "./lib/reply.ts";
import type { Reply, ReplyContext } from "./lib/reply.ts";
import { createSessionStateStore } from "./state.ts";
import type { StateSession } from "./state.ts";

interface Handler {
  handle: (options: { sessionName: string; context: HandlerContext }) => Promise<void>;
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
  const stateStore = createSessionStateStore(config);
  const activeSessions = new Map<string, AgentSession>();
  const cancelledSessions = new WeakSet<AgentSession>();

  async function getManager(agentKey: string) {
    const agent = stateStore.getState().agents[agentKey];
    if (!agent) {
      throw new Error(`Unknown agent: ${agentKey}`);
    }
    return startAcpManager({ command: agent.command, cwd: config.home });
  }

  async function handlePrompt(options: {
    reply: Reply;
    sessionName: string;
    text: string;
    agentKey?: string;
    fresh?: boolean;
    stateSession?: StateSession;
  }): Promise<void> {
    const { reply, stateSession } = options;
    if (activeSessions.has(options.sessionName)) {
      await reply.system("Agent turn already in progress. Send /cancel to stop it.");
      return;
    }

    const state = stateStore.getState();
    const verbose = state.conversations[options.sessionName]?.verbose ?? true;
    const currentSession = options.fresh ? undefined : stateSession;
    const agentKey = options.agentKey ?? currentSession?.agentKey ?? state.defaultAgent;
    const manager = await getManager(agentKey);
    const agentSessionId = currentSession?.agentSessionId;
    const session = agentSessionId
      ? await manager.loadSession({
          sessionCwd: config.home,
          sessionId: agentSessionId,
        })
      : await manager.newSession({ sessionCwd: config.home });

    try {
      const customPrompt = !agentSessionId ? readOptionalPromptFile(config.prompt.file) : undefined;
      const promptText = customPrompt
        ? formatFirstPrompt({ customPrompt, userText: options.text })
        : options.text;

      const { queue } = session.prompt(promptText);
      activeSessions.set(options.sessionName, session);

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
      if (!agentSessionId) {
        stateStore.setCurrentSession(options.sessionName, {
          agentKey,
          agentSessionId: session.sessionId,
        });
      }
    } finally {
      if (activeSessions.get(options.sessionName) === session) {
        activeSessions.delete(options.sessionName);
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
    sessionName: string;
    sessionKeyArg?: string;
  }): Promise<void> {
    const currentSession = stateStore.getCurrentSession(options.sessionName);
    const session = options.sessionKeyArg
      ? resolveSession({ value: options.sessionKeyArg, sessionName: options.sessionName })
      : currentSession;
    if (session) {
      try {
        const manager = await getManager(session.agentKey);
        await manager.closeSession({ sessionId: session.agentSessionId });
      } catch (e) {
        console.error("[acp] closeSession failed:", e);
      }
    }
    if (session) {
      stateStore.deleteSession(session.sessionKey);
    } else if (!options.sessionKeyArg) {
      stateStore.clearCurrentSession(options.sessionName);
    }
  }

  async function handleLoadSession(options: {
    sessionName: string;
    sessionIdArg?: string;
  }): Promise<string> {
    if (!options.sessionIdArg) {
      return "Usage: /session load <sessionId|agent:sessionId>";
    }
    const state = stateStore.getState();
    const parsedSession = stateStore.parseSessionArg({
      value: options.sessionIdArg,
      defaultAgentKey:
        stateStore.getCurrentSession(options.sessionName)?.agentKey ?? state.defaultAgent,
    });
    const manager = await getManager(parsedSession.agentKey);
    const session = await manager.loadSession({
      sessionCwd: config.home,
      sessionId: parsedSession.agentSessionId,
    });
    try {
      const stateSession = stateStore.setCurrentSession(options.sessionName, {
        agentKey: parsedSession.agentKey,
        agentSessionId: session.sessionId,
      });
      return `Loaded session: ${stateSession.sessionKey}`;
    } finally {
      session.close();
    }
  }

  function handleCurrentSession(options: { sessionName: string }): string {
    const state = stateStore.getState();
    const currentSession = stateStore.getCurrentSession(options.sessionName);
    return `\
session: ${options.sessionName}
agent: ${currentSession?.agentKey ?? state.defaultAgent}
session id: ${currentSession?.agentSessionId ?? "none"}`;
  }

  async function handleListSessions(): Promise<string> {
    const state = stateStore.getState();
    const stateSessions = state.sessions;
    const activeAgentSessions = new Set<string>();
    for (const [agentKey] of Object.entries(state.agents)) {
      try {
        const manager = await getManager(agentKey);
        const agentSessions = await manager.listSessions();
        for (const session of agentSessions.sessions) {
          activeAgentSessions.add(
            stateStore.makeSessionKey({ agentKey, agentSessionId: session.sessionId }),
          );
        }
      } catch (e) {
        console.error(`[acp] listSessions failed for agent ${agentKey}:`, e);
      }
    }
    const stateSessionKeys = new Set(Object.keys(stateSessions));
    let output = "";
    for (const [sessionKey, entry] of Object.entries(stateSessions)) {
      output += `- ${sessionKey} -> ${entry.agentSessionId}`;
      if (activeAgentSessions.has(sessionKey)) {
        output += " (active)";
      } else {
        output += " (not active)";
      }
      output += "\n";
    }
    for (const sessionKey of activeAgentSessions) {
      if (!stateSessionKeys.has(sessionKey)) {
        output += `- (unknown) -> ${sessionKey} (active)\n`;
      }
    }
    return output || "No sessions.";
  }

  function resolveSession(options: { value: string; sessionName: string }): StateSession {
    const state = stateStore.getState();
    const parsedSession = stateStore.parseSessionArg({
      value: options.value,
      defaultAgentKey:
        stateStore.getCurrentSession(options.sessionName)?.agentKey ?? state.defaultAgent,
    });
    const sessionKey = stateStore.makeSessionKey(parsedSession);
    return stateStore.getSession(sessionKey) ?? { ...parsedSession, sessionKey };
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
      case undefined: {
        response = handleCurrentSession({ sessionName: options.sessionName });
        break;
      }
      case "list": {
        response = await handleListSessions();
        break;
      }
      case "new": {
        const agentKey =
          args[0] && stateStore.getState().agents[args[0]] ? args.shift() : undefined;
        await handlePrompt({
          reply: options.reply,
          sessionName: options.sessionName,
          text: args.join(" "),
          agentKey,
          fresh: true,
        });
        return true;
      }
      case "load": {
        response = await handleLoadSession({
          sessionName: options.sessionName,
          sessionIdArg: args[0],
        });
        break;
      }
      case "close": {
        await handleCloseSession({
          sessionName: options.sessionName,
          sessionKeyArg: args[0],
        });
        response = "Session closed. Next message will start a fresh session.";
        break;
      }
      default: {
        response = `\
Usage:
/session
/session list
/session new [agent]
/session load <sessionId|agent:sessionId>
/session close [sessionKey]`;
      }
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

  async function handleAgentCommand(options: { reply: Reply; text: string }): Promise<boolean> {
    const [command, subcommand, name, ...args] = options.text.trim().split(/\s+/);
    if (command !== "/agent") {
      return false;
    }

    let response: string;
    switch (subcommand) {
      case "list": {
        const state = stateStore.getState();
        const defaultAgent = state.defaultAgent;
        const agents = state.agents;
        response =
          Object.entries(agents)
            .map(([agentKey, agent]) => {
              const marker = agentKey === defaultAgent ? " (default)" : "";
              return `- ${agentKey} -> ${agent.command}${marker}`;
            })
            .join("\n") || "No agents.";
        break;
      }
      case "new": {
        const agentCommand = args.join(" ");
        if (!name || !agentCommand) {
          response = "Usage: /agent new <name> <command>";
          break;
        }
        stateStore.setAgent(name, { command: agentCommand });
        response = `Saved agent: ${name}`;
        break;
      }
      case "remove": {
        const state = stateStore.getState();
        if (!name) {
          response = "Usage: /agent remove <name>";
          break;
        }
        if (!state.agents[name]) {
          response = `Unknown agent: ${name}`;
          break;
        }
        if (state.defaultAgent === name) {
          response = `Cannot remove default agent: ${name}`;
          break;
        }
        const referencedSessions = Object.values(state.sessions).filter(
          (session) => session.agentKey === name,
        );
        if (referencedSessions.length > 0) {
          response = `\
Cannot remove agent: ${name}
${referencedSessions.length} saved session(s) still reference it.`;
          break;
        }
        stateStore.deleteAgent(name);
        response = `Removed agent: ${name}`;
        break;
      }
      case "default": {
        const state = stateStore.getState();
        if (!name) {
          response = `Default agent: ${state.defaultAgent}`;
          break;
        }
        if (!state.agents[name]) {
          response = `Unknown agent: ${name}`;
          break;
        }
        stateStore.setDefaultAgent(name);
        response = `Default agent: ${name}`;
        break;
      }
      default: {
        response = `\
Usage:
/agent list
/agent new <name> <command>
/agent remove <name>
/agent default [name]`;
      }
    }
    await options.reply.system(response);
    return true;
  }

  async function handleVerboseCommand(options: {
    reply: Reply;
    text: string;
    sessionName: string;
  }): Promise<boolean> {
    const [command, subcommand] = options.text.trim().split(/\s+/);
    if (command !== "/verbose") {
      return false;
    }

    const verbose = stateStore.getState().conversations[options.sessionName]?.verbose ?? true;
    const verboseStatus = `Tool call output: ${verbose ? "on" : "off"}`;
    const verboseHelp = `\
${verboseStatus}
Usage: /verbose [on|off]
`;

    let response: string;
    switch (subcommand) {
      case undefined: {
        response = verboseHelp;
        break;
      }
      case "on": {
        stateStore.setConversation(options.sessionName, {
          verbose: true,
        });
        response = `Tool call output: ${subcommand}`;
        break;
      }
      case "off": {
        stateStore.setConversation(options.sessionName, {
          verbose: false,
        });
        response = `Tool call output: ${subcommand}`;
        break;
      }
      default: {
        response = verboseHelp;
      }
    }
    await options.reply.system(response);
    return true;
  }

  function handleStatus(): string {
    return `\
status: running
version: ${options.version ?? "(unknown)"}
default agent: ${stateStore.getState().defaultAgent}
home: ${config.home}
`;
  }

  const handle: Handler["handle"] = async (options) => {
    const text = options.context.message!.text!;
    const sessionName = options.sessionName;
    const stateSession = stateStore.getCurrentSession(sessionName);
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
    const handledAgentCommand = await handleAgentCommand({
      reply,
      text,
    });
    if (handledAgentCommand) {
      return;
    }
    const handledVerboseCommand = await handleVerboseCommand({
      reply,
      text,
      sessionName,
    });
    if (handledVerboseCommand) {
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
      sessionName,
      text,
      stateSession,
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
