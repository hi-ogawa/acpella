import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "./config.ts";

// TODO: review slop

const stateSchema = z
  .object({
    version: z.literal(1),
    scopes: z.record(
      z.string().min(1), // scopeKey: agent command
      z.object({
        sessions: z.record(
          z.string().min(1), // sessionName
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

export type SessionStateStore = ReturnType<typeof createSessionStateStore>;
export type SessionEntries = Scope;

export function createSessionStateStore(config: Pick<AppConfig, "agent" | "stateFile">) {
  const scopeKey = config.agent.command;

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
    return (state.scopes[scopeKey] ??= { sessions: {} });
  }

  return {
    getSessionId(sessionName: string) {
      return readState().scopes[scopeKey]?.sessions[sessionName]?.sessionId;
    },
    setSessionId(sessionName: string, sessionId: string) {
      const state = readState();
      const scope = ensureScope(state);
      scope.sessions[sessionName] = { sessionId };
      writeState(state);
    },
    deleteSession(sessionName: string) {
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

function emptyState(): State {
  return { version: 1, scopes: {} };
}
