import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "./config.ts";

// TODO: review slop

const agentSchema = z.object({
  command: z.string().min(1),
});

const sessionSchema = z.object({
  agentKey: z.string().min(1),
  agentSessionId: z.string().min(1),
});

const conversationSchema = z.object({
  sessionKey: z.string().min(1).optional(),
  verbose: z.boolean().optional(),
});

const stateSchema = z
  .object({
    version: z.literal(2),
    defaultAgent: z.string().min(1),
    agents: z.record(z.string().min(1), agentSchema),
    conversations: z.record(z.string().min(1), conversationSchema),
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
    for (const [conversationKey, conversation] of Object.entries(state.conversations)) {
      if (conversation.sessionKey && !state.sessions[conversation.sessionKey]) {
        ctx.addIssue({
          code: "custom",
          message: `conversation references missing session: ${conversation.sessionKey}`,
          path: ["conversations", conversationKey, "sessionKey"],
        });
      }
    }
    for (const [sessionKey, session] of Object.entries(state.sessions)) {
      if (!state.agents[session.agentKey]) {
        ctx.addIssue({
          code: "custom",
          message: `session references missing agent: ${session.agentKey}`,
          path: ["sessions", sessionKey, "agentKey"],
        });
      }
    }
  });

export type State = z.infer<typeof stateSchema>;
export type StateAgent = State["agents"][string];
export type StateConversation = State["conversations"][string];
export type StateSession = State["sessions"][string] & { sessionKey: string };
export type SessionStateStore = ReturnType<typeof createSessionStateStore>;

export function createSessionStateStore(config: Pick<AppConfig, "stateFile">) {
  let state = readState();

  // TODO: add a custom command to reload state from disk if manual edits become a supported workflow.

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
    const result = stateSchema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    const resultV1 = stateSchemaV1.safeParse(value);
    if (resultV1.success) {
      console.error("[state] version 1 state is ignored. creating new fresh state.");
      return getInitialState();
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

  return {
    get: () => state,
    set: (updater: (state: State) => void) => {
      updateState(updater);
    },
    setAgent(agentKey: string, agent: State["agents"][string]) {
      updateState((state) => {
        state.agents[agentKey] = agent;
      });
    },
    deleteAgent(agentKey: string) {
      updateState((state) => {
        delete state.agents[agentKey];
      });
    },
    setConversation(conversationKey: string, patch: StateConversation) {
      updateState((state) => {
        state.conversations[conversationKey] = {
          ...state.conversations[conversationKey],
          ...patch,
        };
      });
    },
    getSession(sessionKey: string): StateSession | undefined {
      const session = state.sessions[sessionKey];
      return session ? { ...session, sessionKey } : undefined;
    },
    getCurrentSession(conversationKey: string): StateSession | undefined {
      const sessionKey = state.conversations[conversationKey]?.sessionKey;
      if (!sessionKey) {
        return undefined;
      }
      const session = state.sessions[sessionKey];
      return session ? { ...session, sessionKey } : undefined;
    },
    setCurrentSession(
      conversationKey: string,
      session: { agentKey: string; agentSessionId: string },
    ): StateSession {
      const sessionKey = makeSessionKey(session);
      updateState((state) => {
        state.sessions[sessionKey] = session;
        state.conversations[conversationKey] = {
          ...state.conversations[conversationKey],
          sessionKey,
        };
      });
      return { ...session, sessionKey };
    },
    deleteSession(sessionKey: string) {
      updateState((state) => {
        delete state.sessions[sessionKey];
        for (const conversation of Object.values(state.conversations)) {
          if (conversation.sessionKey === sessionKey) {
            delete conversation.sessionKey;
          }
        }
      });
    },
    clearCurrentSession(conversationKey: string) {
      updateState((state) => {
        if (state.conversations[conversationKey]) {
          delete state.conversations[conversationKey].sessionKey;
        }
      });
    },
    // TODO: export directly
    makeSessionKey,
    parseSessionArg,
  };
}

const BUILTIN_AGENTS: State["agents"] = {
  test: { command: `node ${path.join(import.meta.dirname, "lib/test-agent.ts")}` },
};

function getInitialState(): State {
  return {
    version: 2,
    defaultAgent: Object.keys(BUILTIN_AGENTS)[0],
    agents: { ...BUILTIN_AGENTS },
    conversations: {},
    sessions: {},
  };
}

function makeSessionKey(options: { agentKey: string; agentSessionId: string }): string {
  return `${options.agentKey}:${options.agentSessionId}`;
}

function parseSessionArg(options: { value: string; defaultAgentKey: string }): {
  agentKey: string;
  agentSessionId: string;
} {
  const separatorIndex = options.value.indexOf(":");
  if (separatorIndex === -1) {
    return {
      agentKey: options.defaultAgentKey,
      agentSessionId: options.value,
    };
  }
  return {
    agentKey: options.value.slice(0, separatorIndex),
    agentSessionId: options.value.slice(separatorIndex + 1),
  };
}

const stateSchemaV1 = z.object({
  version: z.literal(1),
  scopes: z.record(
    z.string().min(1),
    z.object({
      sessions: z.record(
        z.string().min(1),
        z.object({
          sessionId: z.string().min(1),
          verbose: z.boolean().optional(),
        }),
      ),
    }),
  ),
});
