import { startAcpManager } from "./acp/index.ts";
import type { AgentSession } from "./acp/index.ts";
import type { AppConfig } from "./config.ts";
import { readOptionalPromptFile } from "./lib/prompt.ts";
import { createReply, MESSAGE_SPLIT_BUDGET } from "./lib/reply.ts";
import type { Reply, ReplyContext } from "./lib/reply.ts";
import { createSessionStateStore, parseAgentSessionKey, toAgentSessionKey } from "./state.ts";
import type { StateAgentSession } from "./state.ts";

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
  handlerOptions: {
    version?: string;
    onServiceExit: () => void;
  },
): Promise<Handler> {
  const stateStore = createSessionStateStore(config);
  const activeSessions = new Map<string, AgentSession>();
  const cancelledSessions = new WeakSet<AgentSession>();

  async function getAgentManager(agentKey: string) {
    const agent = stateStore.get().agents[agentKey];
    if (!agent) {
      throw new Error(`Unknown agent: ${agentKey}`);
    }
    return startAcpManager({ command: agent.command, cwd: config.home });
  }

  async function handlePrompt(options: {
    reply: Reply;
    sessionName: string;
    text: string;
  }): Promise<void> {
    const { reply } = options;
    if (activeSessions.has(options.sessionName)) {
      await reply.system("Agent turn already in progress. Send /cancel to stop it.");
      return;
    }

    const stateSession = stateStore.getSession(options.sessionName);
    const manager = await getAgentManager(stateSession.agentKey);

    let agentSession: AgentSession;
    let promptText = options.text;
    if (stateSession.agentSessionId) {
      agentSession = await manager.loadSession({
        sessionCwd: config.home,
        sessionId: stateSession.agentSessionId,
      });
    } else {
      agentSession = await manager.newSession({ sessionCwd: config.home });
      stateStore.setSession(options.sessionName, {
        agentKey: stateSession.agentKey,
        agentSessionId: agentSession.sessionId,
      });
      const customPrompt = readOptionalPromptFile(config.prompt.file);
      if (customPrompt) {
        promptText = formatFirstPrompt({ customPrompt, userText: promptText });
      }
    }

    try {
      const { queue } = agentSession.prompt(promptText);
      activeSessions.set(options.sessionName, agentSession);

      for await (const update of queue) {
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
          await reply.write(update.content.text);
        } else if (update.sessionUpdate === "tool_call") {
          console.log(`[acp:update] tool_call: ${update.title}`);
          await reply.flush();
          if (stateSession.verbose) {
            await reply.write(`Tool: ${update.title}`);
            await reply.flush();
          }
        } else {
          console.log(`[acp:update] ${update.sessionUpdate}`);
        }
      }
      if (cancelledSessions.has(agentSession)) {
        await reply.flush();
        await reply.system("Agent turn cancelled.");
        return;
      }
      await reply.finish();
    } finally {
      if (activeSessions.get(options.sessionName) === agentSession) {
        activeSessions.delete(options.sessionName);
      }
      agentSession.close();
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
    sessionIdArg?: string;
  }): Promise<string> {
    const stateSession = stateStore.getSession(options.sessionName);
    const parsed = options.sessionIdArg ? parseAgentSessionKey(options.sessionIdArg) : undefined;
    const agentKey = parsed?.agentKey ?? stateSession.agentKey;
    const agentSessionId = parsed?.agentSessionId ?? stateSession.agentSessionId;
    if (!agentSessionId) {
      return "No associated session.";
    }
    const targetSession = { agentKey, agentSessionId };
    stateStore.deleteSession(targetSession);
    let output = `Session closed: ${toAgentSessionKey(targetSession)}.\n`;
    try {
      const manager = await getAgentManager(agentKey);
      await manager.closeSession({ sessionId: agentSessionId });
    } catch (e) {
      output += "[acp] closeSession failed";
      console.error("[acp] closeSession failed:", e);
    }
    return output;
  }

  async function handleLoadSession(options: {
    sessionName: string;
    sessionIdArg?: string;
  }): Promise<string> {
    if (!options.sessionIdArg) {
      return "Usage: /session load <sessionId|agent:sessionId>";
    }
    const stateSession = stateStore.getSession(options.sessionName);
    const parsed = parseAgentSessionKey(options.sessionIdArg);
    const agentKey = parsed.agentKey ?? stateSession.agentKey;
    const manager = await getAgentManager(agentKey);
    const loaded = await manager.loadSession({
      sessionCwd: config.home,
      sessionId: parsed.agentSessionId,
    });
    const newStateSession: StateAgentSession = {
      agentKey,
      agentSessionId: loaded.sessionId,
    };
    try {
      stateStore.setSession(options.sessionName, newStateSession);
      return `Loaded session: ${toAgentSessionKey(newStateSession)}`;
    } finally {
      loaded.close();
    }
  }

  async function handleListSessions(): Promise<string> {
    const state = stateStore.get();
    const activeAgentSessions = new Set<string>();
    for (const [agentKey] of Object.entries(state.agents)) {
      try {
        const manager = await getAgentManager(agentKey);
        const agentSessions = await manager.listSessions();
        for (const session of agentSessions.sessions) {
          activeAgentSessions.add(
            toAgentSessionKey({ agentKey, agentSessionId: session.sessionId }),
          );
        }
      } catch (e) {
        // TODO: include errored agent in message response
        console.error(`[acp] listSessions failed for agent ${agentKey}:`, e);
      }
    }
    const stateAgentSessions = new Map<string, string>();
    for (const [sessionName, stateSession] of Object.entries(state.sessions)) {
      if (stateSession.agentKey && stateSession.agentSessionId) {
        stateAgentSessions.set(
          toAgentSessionKey({
            agentKey: stateSession.agentKey,
            agentSessionId: stateSession.agentSessionId,
          }),
          sessionName,
        );
      }
    }
    let output = "";
    for (const [agentSessionKey, sessionName] of stateAgentSessions) {
      output += `- ${sessionName} -> ${agentSessionKey}`;
      if (activeAgentSessions.has(agentSessionKey)) {
        output += " (active)";
      } else {
        output += " (not active)";
      }
      output += "\n";
    }
    for (const agentSessionKey of activeAgentSessions) {
      if (!stateAgentSessions.has(agentSessionKey)) {
        output += `- (unknown) -> ${agentSessionKey} (active)\n`;
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
    const stateSession = stateStore.getSession(options.sessionName);
    let response: string;
    switch (subcommand) {
      case "current": {
        response = `\
session: ${options.sessionName}
agent: ${stateSession.agentKey}
agent session id: ${stateSession.agentSessionId ?? "none"}
`;
        break;
      }
      case "list": {
        response = await handleListSessions();
        break;
      }
      case "new": {
        const agentKey = args[0];
        if (agentKey) {
          stateStore.setSession(options.sessionName, { agentKey, agentSessionId: undefined });
        }
        await handlePrompt({
          reply: options.reply,
          sessionName: options.sessionName,
          text: "",
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
        response = await handleCloseSession({
          sessionName: options.sessionName,
          sessionIdArg: args[0],
        });
        break;
      }
      default: {
        response = `\
Usage:
/session current
/session list
/session new [agent]
/session load <sessionId|agent:sessionId>
/session close [sessionId|agent:sessionId]`;
      }
    }
    await options.reply.system(response);
    return true;
  }

  async function handleServiceCommand(options: { reply: Reply; text: string }): Promise<boolean> {
    const [command, subcommand] = options.text.trim().split(/\s+/);
    if (command !== "/service") {
      return false;
    }
    if (subcommand === "exit") {
      await options.reply.system("Exiting acpella.");
      handlerOptions.onServiceExit();
      return true;
    }
    await options.reply.system("Usage: /service exit");
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
        const state = stateStore.get();
        response = "";
        for (const [agentKey, agent] of Object.entries(state.agents)) {
          const marker = agentKey === state.defaultAgent ? " (default)" : "";
          response += `- ${agentKey} -> ${agent.command}${marker}\n`;
        }
        response ||= "No agents.";
        break;
      }
      case "new": {
        const agentCommand = args.join(" ");
        if (!name || !agentCommand) {
          response = "Usage: /agent new <name> <command...>";
          break;
        }
        stateStore.set((state) => {
          state.agents[name] = { command: agentCommand };
        });
        response = `Saved new agent: ${name}`;
        break;
      }
      case "remove": {
        const state = stateStore.get();
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
${referencedSessions.length} session(s) still reference it.`;
          break;
        }
        stateStore.set((state) => {
          delete state.agents[name];
        });
        response = `Removed agent: ${name}`;
        break;
      }
      case "default": {
        const state = stateStore.get();
        if (!name) {
          response = `Default agent: ${state.defaultAgent}`;
          break;
        }
        if (!state.agents[name]) {
          response = `Unknown agent: ${name}`;
          break;
        }
        stateStore.set((s) => {
          s.defaultAgent = name;
        });
        response = `Set default agent: ${name}`;
        break;
      }
      default: {
        response = `\
Usage:
/agent list
/agent new <name> <command...>
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

    const verbose = stateStore.get().sessions[options.sessionName]?.verbose ?? true;
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
        stateStore.setSession(options.sessionName, {
          verbose: true,
        });
        response = `Tool call output: ${subcommand}`;
        break;
      }
      case "off": {
        stateStore.setSession(options.sessionName, {
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
version: ${handlerOptions.version ?? "(unknown)"}
default agent: ${stateStore.get().defaultAgent}
home: ${config.home}
`;
  }

  const handle: Handler["handle"] = async (options) => {
    const text = options.context.message!.text!;
    const sessionName = options.sessionName;
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
