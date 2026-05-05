import { fileURLToPath } from "node:url";
import { z } from "zod";
import { sessionRenewPolicySchema } from "./lib/session/renew.ts";
import { verboseModeSchema } from "./lib/session/verbose.ts";
import { FileStateManager, FileWatcher } from "./utils/fs.ts";
import { formatError } from "./utils/index.ts";

const agentSchema = z.object({
  command: z.string().min(1),
});

const agentKeySchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/);

const stateSessionSchema = z.object({
  agentKey: agentKeySchema,
  agentSessionId: z.string().min(1).optional(),
  verbose: verboseModeSchema.optional(),
  renew: sessionRenewPolicySchema.optional(),
  updatedAt: z.number().int().nonnegative().optional(),
});

const agentSessionDataSchema = z.object({
  usage: z
    .object({
      used: z.number(),
      size: z.number(),
      updatedAt: z.number(),
    })
    .optional(),
});

const stateSchema = z
  .object({
    version: z.literal(2),
    defaultAgent: agentKeySchema,
    agents: z.record(agentKeySchema, agentSchema),
    sessions: z.record(z.string().min(1), stateSessionSchema),
    // { [agentKey]: { [agentSessionId]: ... }}
    agentSessions: z
      .record(agentKeySchema, z.record(z.string().min(1), agentSessionDataSchema))
      .optional() // for back compat
      .default({}),
  })
  .superRefine((state, ctx) => {
    if (!state.agents[state.defaultAgent]) {
      ctx.addIssue({
        code: "custom",
        message: `defaultAgent does not exist: ${state.defaultAgent}`,
        path: ["defaultAgent"],
      });
    }
    for (const [sessionName, session] of Object.entries(state.sessions)) {
      if (!session.agentKey) {
        ctx.addIssue({
          code: "custom",
          message: "session must include agentKey",
          path: ["sessions", sessionName, "agentKey"],
        });
      }
      if (session.agentKey && !state.agents[session.agentKey]) {
        ctx.addIssue({
          code: "custom",
          message: `session references missing agent: ${session.agentKey}`,
          path: ["sessions", sessionName, "agentKey"],
        });
      }
    }
  });

export const TEST_AGENT_COMMAND = `node ${fileURLToPath(import.meta.resolve("#test-agent"))}`;

function getStateSchemaDefault(): State {
  return {
    version: 2,
    defaultAgent: "test",
    agents: {
      test: { command: TEST_AGENT_COMMAND },
    },
    sessions: {},
    agentSessions: {},
  };
}

type State = z.infer<typeof stateSchema>;
export type StateSession = State["sessions"][string];
export interface StateAgentSession {
  agentKey: string;
  agentSessionId: string;
}
type AgentSessionData = z.infer<typeof agentSessionDataSchema>;
type AgentSessionUsage = NonNullable<AgentSessionData["usage"]>;

export class SessionStateStore {
  file: FileStateManager<State>;
  watcher: FileWatcher;

  constructor(file: string) {
    this.file = new FileStateManager<State>({
      file,
      parse: stateSchema.parse.bind(stateSchema),
      defaultValue: getStateSchemaDefault,
    });
    this.watcher = new FileWatcher({
      file,
      onChange: () => {
        try {
          if (this.file.reload()) {
            console.log("[state] Reloaded state from external state file change");
          }
        } catch (error) {
          console.error(
            `[state] Failed to reload state after external state file change: ${formatError(error)}`,
          );
        }
      },
    });
  }

  get(): State {
    return this.file.state;
  }

  set(updater: (state: State) => void): void {
    this.file.set(updater);
  }

  getSession(sessionName: string): StateSession {
    const state = this.get();
    const session = state.sessions[sessionName];
    return {
      ...session,
      agentKey: session?.agentKey ?? state.defaultAgent,
      verbose: session?.verbose ?? "thinking",
    };
  }

  setSession(sessionName: string, patch: Partial<StateSession>): void {
    this.set((state) => {
      state.sessions[sessionName] = {
        ...this.getSession(sessionName),
        ...patch,
      };
    });
  }

  deleteSession(target: StateAgentSession): void {
    this.set((state) => {
      for (const [name, session] of Object.entries(state.sessions)) {
        if (
          session.agentKey === target.agentKey &&
          session.agentSessionId === target.agentSessionId
        ) {
          delete state.sessions[name];
        }
      }
    });
  }

  getAgentSessionUsage(target: StateAgentSession): AgentSessionUsage | undefined {
    return this.file.state.agentSessions[target.agentKey]?.[target.agentSessionId]?.usage;
  }

  setAgentSessionUsage(
    target: StateAgentSession,
    usage: Omit<AgentSessionUsage, "updatedAt">,
  ): void {
    this.set((state) => {
      state.agentSessions[target.agentKey] ??= {};
      state.agentSessions[target.agentKey][target.agentSessionId] ??= {};
      state.agentSessions[target.agentKey][target.agentSessionId].usage = {
        used: usage.used,
        size: usage.size,
        updatedAt: Date.now(),
      };
    });
  }
}

export function toAgentSessionKey(options: StateAgentSession): string {
  return `${options.agentKey}:${options.agentSessionId}`;
}

export function parseAgentSessionKey(fullKey: string): {
  agentKey?: string;
  agentSessionId: string;
} {
  const sep = fullKey.indexOf(":");
  if (sep === -1) {
    return {
      agentSessionId: fullKey,
    };
  }
  return {
    agentKey: fullKey.slice(0, sep),
    agentSessionId: fullKey.slice(sep + 1),
  };
}
