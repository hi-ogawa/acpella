import { AgentManager } from "./acp/index.ts";
import type { AgentSessionProcess } from "./acp/index.ts";
import type { AppConfig } from "./config.ts";
import { renderCronList } from "./cron/format.ts";
import type { CronStore } from "./cron/store.ts";
import { createCommandHandler } from "./lib/command.ts";
import type { CommandTree } from "./lib/command.ts";
import { buildFirstPrompt, buildMessageMetadataPrompt } from "./lib/prompt.ts";
import { createReply, MESSAGE_SPLIT_BUDGET } from "./lib/reply.ts";
import type { Reply } from "./lib/reply.ts";
import { parseAgentSessionKey, SessionStateStore, toAgentSessionKey } from "./state.ts";
import type { StateAgentSession, StateSession } from "./state.ts";

export interface Handler {
  handle: (context: HandlerContext) => Promise<void>;
  // TODO: rename?
  promptSession: (options: { sessionName: string; prompt: string }) => Promise<string>;
  commands: Record<string, string>;
}

export interface HandlerContext {
  sessionName: string;
  text: string;
  send: (text: string) => Promise<unknown>;
  metadata?: {
    timestamp: number;
  };
}

interface HandlerExtraContext extends HandlerContext {
  reply: Reply;
}

type SystemCommandTree = CommandTree<HandlerExtraContext>;

export async function createHandler(
  config: AppConfig,
  handlerOptions: {
    version?: string;
    onServiceExit: () => void;
    cronStore: CronStore;
    cronRunner?: {
      refresh: () => void;
    };
  },
): Promise<Handler> {
  const stateStore = new SessionStateStore(config.stateFile);
  const cronStore = handlerOptions.cronStore;
  const activeSessions = new Map<string, AgentSessionProcess>();
  const cancelledSessions = new WeakSet<AgentSessionProcess>();

  async function getAgentManager(agentKey: string) {
    const agent = stateStore.get().agents[agentKey];
    if (!agent) {
      throw new Error(`Unknown agent: ${agentKey}`);
    }
    return new AgentManager({ command: agent.command, cwd: config.home });
  }

  async function handlePrompt(context: HandlerExtraContext): Promise<void> {
    const { reply, sessionName, text, metadata } = context;
    if (activeSessions.has(sessionName)) {
      await reply.system("Agent turn already in progress. Send /cancel to stop it.");
      return;
    }

    const result = await promptAgentSession({
      sessionName,
      text,
      metadata,
      onText: async (chunk) => {
        await reply.write(chunk);
      },
      onToolCall: async (title, stateSession) => {
        await reply.flush();
        if (stateSession.verbose) {
          await reply.write(`Tool: ${title}`);
          await reply.flush();
        }
      },
    });

    if (result.cancelled) {
      await reply.flush();
      await reply.system("Agent turn cancelled.");
      return;
    }
    await reply.finish();
  }

  async function promptAgentSession(options: {
    sessionName: string;
    text: string;
    // TODO: move up?
    metadata?: HandlerContext["metadata"];
    onText: (text: string) => Promise<void> | void;
    onToolCall?: (title: string, stateSession: StateSession) => Promise<void> | void;
  }): Promise<{ cancelled: boolean }> {
    const { sessionName, text, metadata } = options;
    // TODO: move to promptSession?
    if (activeSessions.has(sessionName)) {
      throw new Error("Agent turn already in progress. Send /cancel to stop it.");
    }

    const stateSession = stateStore.getSession(sessionName);
    const manager = await getAgentManager(stateSession.agentKey);

    let session: AgentSessionProcess;
    let promptText = "";
    if (stateSession.agentSessionId) {
      session = await manager.loadSession({
        sessionCwd: config.home,
        sessionId: stateSession.agentSessionId,
      });
    } else {
      session = await manager.newSession({ sessionCwd: config.home });
      stateStore.setSession(sessionName, {
        agentKey: stateSession.agentKey,
        agentSessionId: session.sessionId,
      });
      promptText += buildFirstPrompt(config.prompt.file);
    }
    if (metadata) {
      promptText += buildMessageMetadataPrompt({
        timestamp: metadata.timestamp,
        timezone: config.timezone,
        sessionName,
      });
    }
    promptText += text;

    try {
      const result = session.prompt(promptText);
      activeSessions.set(sessionName, session);

      for await (const update of result.consume()) {
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
          await options.onText(update.content.text);
        } else if (update.sessionUpdate === "tool_call") {
          console.log(`[acp:update] tool_call: ${update.title}`);
          await options.onToolCall?.(update.title, stateSession);
        } else {
          console.log(`[acp:update] ${update.sessionUpdate}`);
        }
      }
      return { cancelled: cancelledSessions.has(session) };
    } finally {
      if (activeSessions.get(sessionName) === session) {
        activeSessions.delete(sessionName);
      }
      session.stop();
    }
  }

  const systemSessionCommands: SystemCommandTree[string] = [
    {
      tokens: ["current"],
      help: "/session current - Show the current session.",
      run: async ({ reply, sessionName }) => {
        const stateSession = stateStore.getSession(sessionName);
        await reply.system(`\
session: ${sessionName}
agent: ${stateSession.agentKey}
agent session id: ${stateSession.agentSessionId ?? "none"}
`);
      },
    },
    {
      tokens: ["list"],
      help: "/session list - List known agent sessions.",
      run: async ({ reply }) => {
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
        await reply.system(output || "No sessions.");
      },
    },
    {
      tokens: ["new"],
      help: "/session new [agent] - Start a new agent session.",
      withArgs: true,
      run: async (context) => {
        const { args, reply, sessionName } = context;
        const agentKey = args[0];
        if (agentKey) {
          if (!stateStore.get().agents[agentKey]) {
            await reply.system(`Unknown agent: ${agentKey}`);
            return;
          }
          stateStore.setSession(sessionName, { agentKey });
        }
        stateStore.setSession(sessionName, { agentSessionId: undefined });
        await handlePrompt({ ...context, text: "" });
      },
    },
    {
      tokens: ["load"],
      help: "/session load <sessionId|agent:sessionId> - Load an existing agent session.",
      withArgs: true,
      run: async ({ args, reply, sessionName }) => {
        const sessionIdArg = args[0];
        if (!sessionIdArg) {
          await reply.system("Usage: /session load <sessionId|agent:sessionId>");
          return;
        }
        const stateSession = stateStore.getSession(sessionName);
        const parsed = parseAgentSessionKey(sessionIdArg);
        const agentKey = parsed.agentKey ?? stateSession.agentKey;
        const manager = await getAgentManager(agentKey);
        const session = await manager.loadSession({
          sessionCwd: config.home,
          sessionId: parsed.agentSessionId,
        });
        const newStateSession: StateAgentSession = {
          agentKey,
          agentSessionId: session.sessionId,
        };
        try {
          stateStore.setSession(sessionName, newStateSession);
          await reply.system(`Loaded session: ${toAgentSessionKey(newStateSession)}`);
        } finally {
          session.stop();
        }
      },
    },
    {
      tokens: ["close"],
      help: "/session close [sessionId|agent:sessionId] - Close an agent session.",
      withArgs: true,
      run: async ({ args, reply, sessionName }) => {
        const stateSession = stateStore.getSession(sessionName);
        const sessionIdArg = args[0];
        const parsed = sessionIdArg ? parseAgentSessionKey(sessionIdArg) : undefined;
        const agentKey = parsed?.agentKey ?? stateSession.agentKey;
        const agentSessionId = parsed?.agentSessionId ?? stateSession.agentSessionId;
        if (!agentSessionId) {
          await reply.system("No associated session.");
          return;
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
        await reply.system(output);
      },
    },
  ];

  const systemAgentCommands: SystemCommandTree[string] = [
    {
      tokens: ["list"],
      help: "/agent list - List configured agents.",
      run: async ({ reply }) => {
        const state = stateStore.get();
        let response = "";
        for (const [agentKey, agent] of Object.entries(state.agents)) {
          const marker = agentKey === state.defaultAgent ? " (default)" : "";
          response += `- ${agentKey} -> ${agent.command}${marker}\n`;
        }
        await reply.system(response || "No agents.");
      },
    },
    {
      tokens: ["new"],
      help: "/agent new <name> <command...> - Save a new agent.",
      withArgs: true,
      run: async ({ args, reply }) => {
        const [name, ...commandParts] = args;
        const command = commandParts.join(" ");
        if (!name || !command) {
          await reply.system("Usage: /agent new <name> <command...>");
          return;
        }
        stateStore.set((state) => {
          state.agents[name] = { command };
        });
        await reply.system(`Saved new agent: ${name}`);
      },
    },
    {
      tokens: ["remove"],
      help: "/agent remove <name> - Remove an agent.",
      withArgs: true,
      run: async ({ args, reply }) => {
        const name = args[0];
        const state = stateStore.get();
        if (!name) {
          await reply.system("Usage: /agent remove <name>");
          return;
        }
        if (!state.agents[name]) {
          await reply.system(`Unknown agent: ${name}`);
          return;
        }
        if (state.defaultAgent === name) {
          await reply.system(`Cannot remove default agent: ${name}`);
          return;
        }
        const referencedSessions = Object.values(state.sessions).filter(
          (session) => session.agentKey === name,
        );
        if (referencedSessions.length > 0) {
          await reply.system(`\
Cannot remove agent: ${name}
${referencedSessions.length} session(s) still reference it.
`);
          return;
        }
        stateStore.set((state) => {
          delete state.agents[name];
        });
        await reply.system(`Removed agent: ${name}`);
      },
    },
    {
      tokens: ["default"],
      help: "/agent default [name] - Show or set the default agent.",
      withArgs: true,
      run: async ({ args, reply }) => {
        const name = args[0];
        const state = stateStore.get();
        if (!name) {
          await reply.system(`Default agent: ${state.defaultAgent}`);
          return;
        }
        if (!state.agents[name]) {
          await reply.system(`Unknown agent: ${name}`);
          return;
        }
        stateStore.set((s) => {
          s.defaultAgent = name;
        });
        await reply.system(`Set default agent: ${name}`);
      },
    },
  ];

  const systemCronCommands: SystemCommandTree[string] = [
    {
      tokens: ["list"],
      help: "/cron list - List cron jobs.",
      run: async ({ reply }) => {
        await reply.system(renderCronList(cronStore));
      },
    },
  ];

  const systemCommands: SystemCommandTree = {
    status: [
      {
        tokens: [],
        help: "/status - Show service status.",
        run: async ({ reply }) => {
          await reply.system(`\
status: running
version: ${handlerOptions.version ?? "(unknown)"}
default agent: ${stateStore.get().defaultAgent}
home: ${config.home}
`);
        },
      },
    ],
    service: [
      {
        tokens: ["exit"],
        help: "/service exit - Exit acpella.",
        run: async ({ reply }) => {
          await reply.system("Exiting acpella.");
          handlerOptions.onServiceExit();
        },
      },
    ],
    cancel: [
      {
        tokens: [],
        help: "/cancel - Cancel the active agent turn.",
        run: async ({ reply, sessionName }) => {
          const session = activeSessions.get(sessionName);
          if (!session) {
            await reply.system("No active agent turn.");
            return;
          }
          cancelledSessions.add(session);
          let response = "Cancelled current agent turn.";
          try {
            await session.cancel();
          } catch (e) {
            console.error("[acp] cancel failed, killing agent process:", e);
            session.stop();
            response = "Cancelled current agent turn by killing the agent process.";
          }
          await reply.system(response);
        },
      },
    ],
    session: systemSessionCommands,
    agent: systemAgentCommands,
    cron: systemCronCommands,
    verbose: [
      {
        tokens: ["current"],
        help: "/verbose current - Show tool-call output setting.",
        run: async ({ reply, sessionName }) => {
          const { verbose } = stateStore.getSession(sessionName);
          await reply.system(`Tool call output: ${verbose ? "on" : "off"}`);
        },
      },
      {
        tokens: ["on"],
        help: "/verbose on - Show tool-call updates.",
        run: async ({ reply, sessionName }) => {
          stateStore.setSession(sessionName, {
            verbose: true,
          });
          await reply.system("Tool call output: on");
        },
      },
      {
        tokens: ["off"],
        help: "/verbose off - Hide tool-call updates.",
        run: async ({ reply, sessionName }) => {
          stateStore.setSession(sessionName, {
            verbose: false,
          });
          await reply.system("Tool call output: off");
        },
      },
    ],
  };

  const systemCommandsMetadata: Record<string, string> = {
    help: "Show available commands",
    status: "Show service status",
    service: "Manager service",
    cancel: "Cancel currently active agent turn",
    session: "Manage sessions",
    agent: "Manage agents",
    cron: "Manage cron jobs",
    verbose: "Configure tool output",
  };

  const systemCommandHandler = createCommandHandler({
    commands: systemCommands,
    onUsage: async (usage, context) => {
      await context.reply.system(usage);
    },
  });

  const handle: Handler["handle"] = async (context) => {
    const reply = createReply({
      send: context.send,
      limit: MESSAGE_SPLIT_BUDGET,
    });
    const extraContext: HandlerExtraContext = { ...context, reply };

    const handledSystem = await systemCommandHandler.handle({
      text: extraContext.text,
      context: extraContext,
    });
    if (handledSystem) {
      return;
    }

    await handlePrompt(extraContext);
  };

  // TODO: how to serialize prompt for cron and normal messages?
  const promptSession: Handler["promptSession"] = async ({ sessionName, prompt }) => {
    const chunks: string[] = [];
    const result = await promptAgentSession({
      sessionName,
      text: prompt,
      onText: (chunk) => {
        chunks.push(chunk);
      },
    });
    if (result.cancelled) {
      throw new Error("Agent turn cancelled.");
    }
    return chunks.join("");
  };

  return { handle, promptSession, commands: systemCommandsMetadata };
}
