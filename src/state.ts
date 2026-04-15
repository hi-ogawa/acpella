import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "./config.ts";

const agentSchema = z.object({
  command: z.string().min(1),
});

const stateSessionSchema = z.object({
  agentKey: z.string().min(1),
  agentSessionId: z.string().min(1).optional(),
  verbose: z.boolean().optional(),
});

const stateSchema = z
  .object({
    version: z.literal(2),
    defaultAgent: z.string().min(1),
    agents: z.record(z.string().min(1), agentSchema),
    sessions: z.record(z.string().min(1), stateSessionSchema),
  })
  .superRefine((state, ctx) => {
    if (!state.agents[state.defaultAgent]) {
      ctx.addIssue({
        code: "custom",
        message: `defaultAgent does not exist: ${state.defaultAgent}`,
        path: ["agents"],
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
export type SessionStateStore = ReturnType<typeof createSessionStateStore>;

export interface StateAgentSession {
  agentKey: string;
  agentSessionId: string;
}

export function createSessionStateStore(config: Pick<AppConfig, "stateFile">) {
  // TODO: add a custom command to reload state from disk if manual edits become a supported workflow.
  let state = readState();

  function readState(): State {
    if (fs.existsSync(config.stateFile)) {
      try {
        const data = fs.readFileSync(config.stateFile, "utf8");
        return parseState(JSON.parse(data));
      } catch (e) {
        console.error("[state] readState failed:", e);
      }
    }
    return getInitialState();
  }

  function parseState(value: unknown): State {
    const version =
      value && typeof value === "object" && "version" in value ? value.version : undefined;
    if (version === 1) {
      throw new Error("version 1 state is ignored. creating new fresh state.");
    }
    return stateSchema.parse(value);
  }

  function writeState(nextState: State): void {
    fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
    fs.writeFileSync(config.stateFile, JSON.stringify(nextState, null, 2));
  }

  function updateState(updater: (state: State) => void): void {
    // Mutate a draft so validation failures do not leave the in-memory cache
    // ahead of the persisted state.
    const nextState = structuredClone(state);
    updater(nextState);
    state = stateSchema.parse(nextState);
    writeState(state);
  }

  const store = {
    get: () => state,
    set: updateState,
    getSession(sessionName: string): StateSession {
      const session = state.sessions[sessionName];
      return {
        ...session,
        agentKey: session?.agentKey ?? state.defaultAgent,
        verbose: session?.verbose ?? false,
      };
    },
    setSession(sessionName: string, patch: Partial<StateSession>) {
      updateState((state) => {
        state.sessions[sessionName] = {
          ...store.getSession(sessionName),
          ...patch,
        };
      });
    },
    deleteSession(target: StateAgentSession) {
      updateState((state) => {
        for (const [name, session] of Object.entries(state.sessions)) {
          if (
            session.agentKey === target.agentKey &&
            session.agentSessionId === target.agentSessionId
          ) {
            delete state.sessions[name];
          }
        }
      });
    },
  };

  return store;
}

const BUILTIN_AGENT_KEY = "test";

const BUILTIN_AGENTS: State["agents"] = {
  [BUILTIN_AGENT_KEY]: { command: `node ${path.join(import.meta.dirname, "lib/test-agent.ts")}` },
};

function getInitialState(): State {
  return {
    version: 2,
    defaultAgent: BUILTIN_AGENT_KEY,
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
