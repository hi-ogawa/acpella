import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "./config.ts";

export interface SessionStateStore {
  getSessionId: (sessionName: string) => string | undefined;
  setSessionId: (sessionName: string, sessionId: string) => void;
  deleteSession: (sessionName: string) => void;
  listSessions: () => { name: string; sessionId: string }[];
}

const stateSchema = z
  .object({
    version: z.literal(1),
    scopes: z.record(
      z.string().min(1),
      z.object({
        agent: z.object({
          alias: z.string().min(1),
          command: z.string().min(1),
        }),
        home: z.string().min(1),
        sessions: z.record(
          z.string().min(1),
          z.object({
            sessionId: z.string().min(1),
          }),
        ),
      }),
    ),
  })
  .strict();

type State = z.infer<typeof stateSchema>;
type Scope = State["scopes"][string];

export function createSessionStateStore(
  config: Pick<AppConfig, "agent" | "home" | "stateFile">,
): SessionStateStore {
  const scopeKey = createScopeKey(config);

  function readState(): State {
    if (!fs.existsSync(config.stateFile)) {
      return emptyState();
    }
    try {
      const raw = JSON.parse(fs.readFileSync(config.stateFile, "utf8")) as unknown;
      return stateSchema.parse(raw);
    } catch (e) {
      console.error("[state] readState failed:", e);
      return emptyState();
    }
  }

  function writeState(state: State): void {
    fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
    fs.writeFileSync(config.stateFile, JSON.stringify(state, null, 2));
  }

  function ensureScope(state: State): Scope {
    const existing = state.scopes[scopeKey];
    if (existing) {
      return existing;
    }
    const scope: Scope = {
      agent: config.agent,
      home: config.home,
      sessions: {},
    };
    state.scopes[scopeKey] = scope;
    return scope;
  }

  return {
    getSessionId(sessionName) {
      return readState().scopes[scopeKey]?.sessions[sessionName]?.sessionId;
    },
    setSessionId(sessionName, sessionId) {
      const state = readState();
      const scope = ensureScope(state);
      scope.sessions[sessionName] = { sessionId };
      writeState(state);
    },
    deleteSession(sessionName) {
      const state = readState();
      const scope = state.scopes[scopeKey];
      if (!scope || !(sessionName in scope.sessions)) {
        return;
      }
      delete scope.sessions[sessionName];
      writeState(state);
    },
    listSessions() {
      const sessions = readState().scopes[scopeKey]?.sessions ?? {};
      return Object.entries(sessions)
        .map(([name, session]) => ({ name, sessionId: session.sessionId }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}

function createScopeKey(config: Pick<AppConfig, "agent" | "home">): string {
  return `${config.agent.alias}:${hash(config.agent.command)}:${hash(config.home)}`;
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function emptyState(): State {
  return { version: 1, scopes: {} };
}
