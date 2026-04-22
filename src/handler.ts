import path from "path";
import { AgentManager } from "./acp/index.ts";
import type { AgentSessionProcess } from "./acp/index.ts";
import type { AppConfig } from "./config.ts";
import {
  parseCronAddArgs,
  parseCronIdArg,
  renderCronList,
  renderCronShow,
} from "./cron/command.ts";
import type { CronRunner, CronRunnerAgentOptions } from "./cron/runner.ts";
import type { CronDeliveryTarget, CronStore } from "./cron/store.ts";
import { createCommandHandler } from "./lib/command.ts";
import type { CommandTree } from "./lib/command.ts";
import { JsonLogger } from "./lib/logger.ts";
import { buildFirstPrompt, buildMessageMetadataPrompt } from "./lib/prompt.ts";
import { MESSAGE_SPLIT_BUDGET, ReplyManager } from "./lib/reply.ts";
import { AsyncLane, DefaultMap, formatError } from "./lib/utils.ts";
import { parseAgentSessionKey, SessionStateStore, toAgentSessionKey } from "./state.ts";
import type { StateAgentSession, StateSession } from "./state.ts";

export interface Handler {
  handle: (context: HandlerContext) => Promise<void>;
  prompt: CronRunnerAgentOptions["prompt"];
  commands: Record<string, string>;
}

export interface HandlerContext {
  sessionName: string;
  text: string;
  send: (text: string) => Promise<unknown>;
  metadata?: {
    timestamp?: number;
    cronDeliveryTarget?: CronDeliveryTarget;
  };
}

interface HandlerExtraContext extends HandlerContext {
  reply: ReplyManager;
}

type SystemCommandTree = CommandTree<HandlerExtraContext>;

export async function createHandler(
  config: AppConfig,
  handlerOptions: {
    version?: string;
    onServiceExit: () => void;
    cronStore: CronStore;
    getCronRunner?: () => CronRunner;
  },
): Promise<Handler> {
  const stateStore = new SessionStateStore(config.stateFile);
  const cronStore = handlerOptions.cronStore;
  const activeSessions = new Map<string, AgentSessionProcess>();
  const cancelledSessions = new WeakSet<AgentSessionProcess>();
  // TODO: refactor activeSessions/cancelledSessions by AsyncLane?
  const activePromptLanes = new DefaultMap<string, AsyncLane>({
    init: () => new AsyncLane(),
  });

  async function getAgentManager(agentKey: string) {
    const agent = stateStore.get().agents[agentKey];
    if (!agent) {
      throw new Error(`Unknown agent: ${agentKey}`);
    }
    return new AgentManager({ command: agent.command, cwd: config.home });
  }

  async function handlePrompt(context: HandlerExtraContext): Promise<void> {
    let { reply, sessionName, metadata } = context;
    let promptText = "";
    if (metadata?.timestamp) {
      promptText = buildMessageMetadataPrompt({
        timestamp: metadata.timestamp,
        timezone: config.timezone,
        sessionName,
      });
    }
    promptText += context.text;

    const result = await handlePromptImpl({
      sessionName,
      text: promptText,
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

  // This ensures that prompts from multiple sources (for example, normal prompts
  // and cron) for the same session are processed sequentially.
  // Note that Telegram requests for the same session are already serialized
  // at the bot handler level via `@grammyjs/runner`.
  const handlePromptImpl: typeof handlePromptImplInner = (options) => {
    return activePromptLanes.get(options.sessionName).run(() => handlePromptImplInner(options));
  };

  async function handlePromptImplInner(options: {
    sessionName: string;
    text: string;
    onText: (text: string) => Promise<void> | void;
    onToolCall?: (title: string, stateSession: StateSession) => Promise<void> | void;
  }): Promise<{ cancelled: boolean }> {
    const { sessionName, text } = options;
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
    promptText += text;

    const logger = new JsonLogger({
      file: path.join(config.logsDir, `acp/${stateSession.agentKey}/${session.sessionId}.jsonl`),
    });
    logger.log({ type: "prompt", text: promptText });

    try {
      const result = session.prompt(promptText);
      activeSessions.set(sessionName, session);

      for await (const update of result.consume()) {
        // TODO: update loggging needs to be batched
        logger.log({ type: "session_update", update });
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
          await options.onText(update.content.text);
        } else if (update.sessionUpdate === "tool_call") {
          await options.onToolCall?.(update.title, stateSession);
        } else if (update.sessionUpdate === "usage_update") {
          stateStore.setAgentSessionUsage(
            { agentKey: stateSession.agentKey, agentSessionId: session.sessionId },
            update,
          );
        }
      }
      const cancelled = cancelledSessions.has(session);
      logger.log({ type: "done", cancelled });
      return { cancelled };
    } catch (e) {
      logger.log({ type: "error", error: formatError(e) });
      throw e;
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
        let output = `\
session: ${sessionName}
agent: ${stateSession.agentKey}
agent session id: ${stateSession.agentSessionId ?? "none"}
`;
        const usage = stateSession.agentSessionId
          ? stateStore.getAgentSessionUsage({
              agentKey: stateSession.agentKey,
              agentSessionId: stateSession.agentSessionId,
            })
          : undefined;
        if (usage) {
          const pct = Math.round((usage.used / usage.size) * 100);
          output += `context: ${usage.used} / ${usage.size} tokens (${pct}%)`;
        }
        await reply.system(output);
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
        await context.reply.system("New session ready.");
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

  const cronAddCommand = `/cron add <id> <minute> <hour> <day-of-month> <month> <day-of-week> <prompt...>`;
  const getCronRunner = () => handlerOptions.getCronRunner?.();
  const systemCronCommands: SystemCommandTree[string] = [
    {
      tokens: ["status"],
      help: "/cron status - Show cron scheduler status.",
      run: async ({ reply }) => {
        const cronRunner = getCronRunner();
        const jobs = cronStore.listJobs();
        const enabledJobs = jobs.filter((job) => job.enabled);
        await reply.system(`\
cron runner: ${cronRunner?.isRunning() ? "running" : "stopped"}
jobs: ${jobs.length}
enabled jobs: ${enabledJobs.length}
`);
      },
    },
    {
      tokens: ["start"],
      help: "/cron start - Start cron scheduler.",
      run: async ({ reply }) => {
        const cronRunner = getCronRunner();
        if (!cronRunner) {
          await reply.system("Cron runner is unavailable.");
          return;
        }
        cronRunner.start();
        await reply.system("Cron runner started.");
      },
    },
    {
      tokens: ["stop"],
      help: "/cron stop - Stop cron scheduler.",
      run: async ({ reply }) => {
        const cronRunner = getCronRunner();
        if (!cronRunner) {
          await reply.system("Cron runner is unavailable.");
          return;
        }
        cronRunner.stop();
        await reply.system("Cron runner stopped.");
      },
    },
    {
      tokens: ["reload"],
      help: "/cron reload - Reload cron jobs from disk.",
      run: async ({ reply }) => {
        try {
          cronStore.reload();
          getCronRunner()?.refresh();
          await reply.system("Reloaded cron jobs.");
        } catch (error) {
          await reply.system(`Failed to reload cron jobs: ${formatError(error)}`);
        }
      },
    },
    {
      tokens: ["add"],
      help: `${cronAddCommand} - Add a cron job.`,
      withArgs: true,
      run: async ({ args, reply, sessionName, metadata }) => {
        if (!metadata?.cronDeliveryTarget) {
          await reply.system("Cannot add cron job: delivery target is unavailable.");
          return;
        }
        const parsed = parseCronAddArgs(args, config.timezone);
        if (!parsed.ok) {
          await reply.system(`${parsed.value}\nUsage: ${cronAddCommand}`);
          return;
        }
        const cron = parsed.value;
        try {
          cronStore.addJob({
            id: cron.id,
            enabled: true,
            schedule: cron.schedule,
            timezone: config.timezone,
            prompt: cron.prompt,
            target: {
              sessionName,
              delivery: metadata.cronDeliveryTarget,
            },
          });
          getCronRunner()?.refresh();
          await reply.system(`Added cron job: ${cron.id}`);
        } catch (error) {
          await reply.system(`Failed to add cron job: ${formatError(error)}`);
        }
      },
    },
    {
      tokens: ["list"],
      help: "/cron list - List cron jobs.",
      run: async ({ reply }) => {
        await reply.system(renderCronList(cronStore));
      },
    },
    {
      tokens: ["show"],
      help: "/cron show <id> - Show a cron job.",
      withArgs: true,
      run: async ({ args, reply }) => {
        const parsed = parseCronIdArg(args, "Usage: /cron show <id>");
        if (!parsed.ok) {
          await reply.system(parsed.value);
          return;
        }
        const { id } = parsed.value;
        const job = cronStore.getJob(id);
        if (!job) {
          await reply.system(`Unknown cron job: ${id}`);
          return;
        }
        await reply.system(renderCronShow(job, cronStore.getLatestRun({ cronId: id })));
      },
    },
    {
      tokens: ["enable"],
      help: "/cron enable <id> - Enable a cron job.",
      withArgs: true,
      run: async ({ args, reply }) => {
        const parsed = parseCronIdArg(args, "Usage: /cron enable <id>");
        if (!parsed.ok) {
          await reply.system(parsed.value);
          return;
        }
        const { id } = parsed.value;
        if (!cronStore.getJob(id)) {
          await reply.system(`Unknown cron job: ${id}`);
          return;
        }
        try {
          cronStore.updateJob(id, { enabled: true });
          getCronRunner()?.refresh();
          await reply.system(`Enabled cron job: ${id}`);
        } catch (error) {
          await reply.system(`Failed to enable cron job: ${formatError(error)}`);
        }
      },
    },
    {
      tokens: ["disable"],
      help: "/cron disable <id> - Disable a cron job.",
      withArgs: true,
      run: async ({ args, reply }) => {
        const parsed = parseCronIdArg(args, "Usage: /cron disable <id>");
        if (!parsed.ok) {
          await reply.system(parsed.value);
          return;
        }
        const { id } = parsed.value;
        if (!cronStore.getJob(id)) {
          await reply.system(`Unknown cron job: ${id}`);
          return;
        }
        try {
          cronStore.updateJob(id, { enabled: false });
          getCronRunner()?.refresh();
          await reply.system(`Disabled cron job: ${id}`);
        } catch (error) {
          await reply.system(`Failed to disable cron job: ${formatError(error)}`);
        }
      },
    },
    {
      tokens: ["delete"],
      help: "/cron delete <id> - Delete a cron job.",
      withArgs: true,
      run: async ({ args, reply }) => {
        const parsed = parseCronIdArg(args, "Usage: /cron delete <id>");
        if (!parsed.ok) {
          await reply.system(parsed.value);
          return;
        }
        const { id } = parsed.value;
        if (!cronStore.getJob(id)) {
          await reply.system(`Unknown cron job: ${id}`);
          return;
        }
        try {
          cronStore.deleteJob(id);
          getCronRunner()?.refresh();
          await reply.system(`Deleted cron job: ${id}`);
        } catch (error) {
          await reply.system(`Failed to delete cron job: ${formatError(error)}`);
        }
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
    const reply = new ReplyManager({
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

  const handleCronPrompt: Handler["prompt"] = async ({ sessionName, text }) => {
    const chunks: string[] = [];
    const result = await handlePromptImpl({
      sessionName,
      text,
      onText: (chunk) => {
        chunks.push(chunk);
      },
    });
    if (result.cancelled) {
      throw new Error("Agent turn cancelled.");
    }
    return chunks.join("");
  };

  return { handle, prompt: handleCronPrompt, commands: systemCommandsMetadata };
}
