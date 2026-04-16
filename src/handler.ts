import { startAcpManager } from "./acp/index.ts";
import type { AgentSession } from "./acp/index.ts";
import type { AppConfig } from "./config.ts";
import { createCommandHandler } from "./lib/command.ts";
import type { CommandTree } from "./lib/command.ts";
import { readOptionalPromptFile } from "./lib/prompt.ts";
import { createReply, MESSAGE_SPLIT_BUDGET } from "./lib/reply.ts";
import type { Reply, ReplyContext } from "./lib/reply.ts";
import { createSessionStateStore, parseAgentSessionKey, toAgentSessionKey } from "./state.ts";
import type { StateAgentSession } from "./state.ts";

export interface Handler {
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

  async function handlePrompt({
    reply,
    sessionName,
    text,
  }: {
    reply: Reply;
    sessionName: string;
    text: string;
  }): Promise<void> {
    if (activeSessions.has(sessionName)) {
      await reply.system("Agent turn already in progress. Send /cancel to stop it.");
      return;
    }

    const stateSession = stateStore.getSession(sessionName);
    const manager = await getAgentManager(stateSession.agentKey);

    let agentSession: AgentSession;
    let promptText = text;
    if (stateSession.agentSessionId) {
      agentSession = await manager.loadSession({
        sessionCwd: config.home,
        sessionId: stateSession.agentSessionId,
      });
    } else {
      agentSession = await manager.newSession({ sessionCwd: config.home });
      stateStore.setSession(sessionName, {
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
      activeSessions.set(sessionName, agentSession);

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
      if (activeSessions.get(sessionName) === agentSession) {
        activeSessions.delete(sessionName);
      }
      agentSession.close();
    }
  }

  type SystemCommandContext = {
    reply: Reply;
    sessionName: string;
  };

  const systemSessionCommands: CommandTree<SystemCommandContext>[string] = [
    {
      path: ["current"],
      usage: "/session current",
      summary: "Show the current session.",
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
      path: ["list"],
      usage: "/session list",
      summary: "List known agent sessions.",
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
      path: ["new"],
      usage: "/session new [agent]",
      summary: "Start a new agent session.",
      match: "prefix",
      run: async ({ invocation, reply, sessionName }) => {
        const agentKey = invocation.args[0];
        if (agentKey) {
          if (!stateStore.get().agents[agentKey]) {
            await reply.system(`Unknown agent: ${agentKey}`);
            return;
          }
          stateStore.setSession(sessionName, { agentKey, agentSessionId: undefined });
        }
        await handlePrompt({
          reply,
          sessionName,
          text: "",
        });
      },
    },
    {
      path: ["load"],
      // TODO: support <agent:sessionId> only
      usage: "/session load <sessionId|agent:sessionId>",
      summary: "Load an existing agent session.",
      match: "prefix",
      run: async ({ invocation, reply, sessionName }) => {
        const sessionIdArg = invocation.args[0];
        if (!sessionIdArg) {
          await reply.system("Usage: /session load <sessionId|agent:sessionId>");
          return;
        }
        const stateSession = stateStore.getSession(sessionName);
        const parsed = parseAgentSessionKey(sessionIdArg);
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
          stateStore.setSession(sessionName, newStateSession);
          await reply.system(`Loaded session: ${toAgentSessionKey(newStateSession)}`);
        } finally {
          loaded.close();
        }
      },
    },
    {
      path: ["close"],
      usage: "/session close [sessionId|agent:sessionId]",
      summary: "Close an agent session.",
      match: "prefix",
      run: async ({ invocation, reply, sessionName }) => {
        const stateSession = stateStore.getSession(sessionName);
        const sessionIdArg = invocation.args[0];
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

  const systemAgentCommands: CommandTree<SystemCommandContext>["agent"] = [
    {
      path: ["list"],
      usage: "/agent list",
      summary: "List configured agents.",
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
      path: ["new"],
      usage: "/agent new <name> <command...>",
      summary: "Save a new agent.",
      match: "prefix",
      run: async ({ invocation, reply }) => {
        const [name, ...args] = invocation.args;
        const agentCommand = args.join(" ");
        if (!name || !agentCommand) {
          await reply.system("Usage: /agent new <name> <command...>");
          return;
        }
        stateStore.set((state) => {
          state.agents[name] = { command: agentCommand };
        });
        await reply.system(`Saved new agent: ${name}`);
      },
    },
    {
      path: ["remove"],
      usage: "/agent remove <name>",
      summary: "Remove an agent.",
      match: "prefix",
      run: async ({ invocation, reply }) => {
        const name = invocation.args[0];
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
${referencedSessions.length} session(s) still reference it.`);
          return;
        }
        stateStore.set((state) => {
          delete state.agents[name];
        });
        await reply.system(`Removed agent: ${name}`);
      },
    },
    {
      path: ["default"],
      usage: "/agent default [name]",
      summary: "Show or set the default agent.",
      match: "prefix",
      run: async ({ invocation, reply }) => {
        const name = invocation.args[0];
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

  const systemCommands: CommandTree<SystemCommandContext> = {
    status: [
      {
        path: [],
        usage: "/status",
        summary: "Show service status.",
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
        path: ["exit"],
        usage: "/service exit",
        summary: "Exit acpella.",
        run: async ({ reply }) => {
          await reply.system("Exiting acpella.");
          handlerOptions.onServiceExit();
        },
      },
    ],
    cancel: [
      {
        path: [],
        usage: "/cancel",
        summary: "Cancel the active agent turn.",
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
            session.close();
            response = "Cancelled current agent turn by killing the agent process.";
          }
          await reply.system(response);
        },
      },
    ],
    session: systemSessionCommands,
    agent: systemAgentCommands,
    verbose: [
      {
        path: ["current"],
        usage: "/verbose current",
        summary: "Show tool-call output setting.",
        run: async ({ reply, sessionName }) => {
          const { verbose } = stateStore.getSession(sessionName);
          await reply.system(`Tool call output: ${verbose ? "on" : "off"}`);
        },
      },
      {
        path: ["on"],
        usage: "/verbose on",
        summary: "Show tool-call updates.",
        run: async ({ reply, sessionName }) => {
          stateStore.setSession(sessionName, {
            verbose: true,
          });
          await reply.system("Tool call output: on");
        },
      },
      {
        path: ["off"],
        usage: "/verbose off",
        summary: "Hide tool-call updates.",
        run: async ({ reply, sessionName }) => {
          stateStore.setSession(sessionName, {
            verbose: false,
          });
          await reply.system("Tool call output: off");
        },
      },
    ],
  };

  const systemCommandHandler = createCommandHandler({
    commands: systemCommands,
    onUsage: async (usage, context) => {
      await context.reply.system(usage);
    },
  });

  const handle: Handler["handle"] = async (options) => {
    const text = options.context.message!.text!;
    const sessionName = options.sessionName;
    const reply = createReply({
      context: options.context,
      limit: MESSAGE_SPLIT_BUDGET,
    });

    const handledSystem = await systemCommandHandler.handle({
      text,
      context: { reply, sessionName },
    });
    if (handledSystem) {
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
