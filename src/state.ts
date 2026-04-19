import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

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

const stateSchema = z
  .object({
    version: z.literal(2),
    defaultAgent: agentKeySchema,
    agents: z.record(agentKeySchema, agentSchema),
    sessions: z.record(z.string().min(1), stateSessionSchema),
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

export class SessionStateStore {
  file: string;
  state: State;

  constructor(file: string) {
    this.file = file;
    this.state = this.readState();
  }

  get(): State {
    return this.state;
  }

  set(updater: (state: State) => void): void {
    // Mutate a draft so validation failures do not leave the in-memory cache
    // ahead of the persisted state.
    const nextState = structuredClone(this.state);
    updater(nextState);
    this.state = stateSchema.parse(nextState);
    this.writeState(this.state);
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

  private readState(): State {
    if (fs.existsSync(this.file)) {
      try {
        const data = fs.readFileSync(this.file, "utf8");
        return this.parseState(JSON.parse(data));
      } catch (e) {
        console.error("[state] readState failed:", e);
      }
    }
    return getInitialState();
  }

  private parseState(value: unknown): State {
    const version =
      value && typeof value === "object" && "version" in value ? value.version : undefined;
    if (version === 1) {
      throw new Error("version 1 state is ignored. creating new fresh state.");
    }
    return stateSchema.parse(value);
  }

  private writeState(nextState: State): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(nextState, null, 2));
  }
}

// function readFileAndParse<T>(file: string, parser: (data: string) => T): T {
// }

// function writeFileJson(file: string, data: unknown): void {
//   fs.mkdirSync(path.dirname(file), { recursive: true });
//   fs.writeFileSync(file, JSON.stringify(data, null, 2));
// }

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
