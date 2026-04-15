import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "./config.ts";

// TODO: review slop

const agentSchema = z.object({
  command: z.string().min(1),
});

const sessionSchema = z.object({
  agentKey: z.string().min(1).optional(), // TODO: doesn't make sense actually
  agentSessionId: z.string().min(1).optional(),
  verbose: z.boolean().optional(),
});

const stateSchema = z
  .object({
    version: z.literal(2),
    defaultAgent: z.string().min(1),
    agents: z.record(z.string().min(1), agentSchema),
    sessions: z.record(z.string().min(1), sessionSchema),
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
      if (Boolean(session.agentKey) !== Boolean(session.agentSessionId)) {
        ctx.addIssue({
          code: "custom",
          message: "session must include both agentKey and agentSessionId",
          path: ["sessions", sessionName],
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

export interface NormalizedStateSession {
  agentKey: string;
  agentSessionId?: string;
  verbose: boolean;
}

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
    setSession(sessionName: string, patch: StateSession) {
      updateState((state) => {
        state.sessions[sessionName] = {
          ...state.sessions[sessionName],
          ...patch,
        };
      });
    },
    // TODO: deslop
    getSession(sessionName: string): StateSession | undefined {
      const session = state.sessions[sessionName];
      if (!session?.agentKey || !session.agentSessionId) {
        return undefined;
      }
      return {
        agentKey: session.agentKey,
        agentSessionId: session.agentSessionId,
      };
    },
    getSession2(sessionName: string): NormalizedStateSession {
      const session = state.sessions[sessionName];
      return {
        agentKey: session?.agentKey ?? state.defaultAgent,
        agentSessionId: session?.agentSessionId,
        verbose: session?.verbose ?? false,
      };
    },
    deleteSession(session: { agentKey: string; agentSessionId: string }) {
      updateState((state) => {
        for (const stateSession of Object.values(state.sessions)) {
          if (
            stateSession.agentKey === session.agentKey &&
            stateSession.agentSessionId === session.agentSessionId
          ) {
            delete stateSession.agentKey;
            delete stateSession.agentSessionId;
          }
        }
      });
    },
    clearSession(sessionName: string) {
      updateState((state) => {
        if (state.sessions[sessionName]) {
          delete state.sessions[sessionName].agentKey;
          delete state.sessions[sessionName].agentSessionId;
        }
      });
    },
  };

  return store;
}

const BUILTIN_AGENTS: State["agents"] = {
  test: { command: `node ${path.join(import.meta.dirname, "lib/test-agent.ts")}` },
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
