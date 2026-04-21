import path from "node:path";
import { z } from "zod";
import { FileStateManager } from "./lib/utils-node.ts";

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
  verbose: z.boolean().optional(),
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

export type State = z.infer<typeof stateSchema>;
export type StateSession = State["sessions"][string];
export interface StateAgentSession {
  agentKey: string;
  agentSessionId: string;
}
type AgentSessionData = z.infer<typeof agentSessionDataSchema>;
type AgentSessionUsage = NonNullable<AgentSessionData["usage"]>;

export class SessionStateStore {
  file: FileStateManager<State>;

  constructor(file: string) {
    this.file = new FileStateManager<State>({
      file,
      parse: stateSchema.parse.bind(stateSchema),
      defaultValue: getInitialState,
    });
  }

  // TODO(refactor): remove thin wrappers
  get state(): State {
    return this.file.state;
  }

  get(): State {
    return this.file.state;
  }

  set(updater: (state: State) => void): void {
    this.file.set(updater);
  }

  getSession(sessionName: string): StateSession {
    const session = this.state.sessions[sessionName];
    return {
      ...session,
      agentKey: session?.agentKey ?? this.state.defaultAgent,
      verbose: session?.verbose ?? false,
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

  getAgentSessionUsage(taget: StateAgentSession): AgentSessionUsage | undefined {
    return this.file.state.agentSessions[taget.agentKey]?.[taget.agentSessionId]?.usage;
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

  deleteAgentSessionData(target: StateAgentSession): void {
    this.set((state) => {
      state.agentSessions[target.agentKey] ??= {};
      delete state.agentSessions[target.agentKey][target.agentSessionId];
    });
  }
}

export const TEST_AGENT_COMMAND = `node ${path.join(import.meta.dirname, "lib/test-agent.ts")}`;

const BUILTIN_AGENTS: State["agents"] = {
  test: { command: TEST_AGENT_COMMAND },
};

function getInitialState(): State {
  return {
    version: 2,
    defaultAgent: Object.keys(BUILTIN_AGENTS)[0],
    agents: { ...BUILTIN_AGENTS },
    sessions: {},
    agentSessions: {},
  };
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
