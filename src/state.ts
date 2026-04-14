import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "./config.ts";

// TODO: review slop

// TODO: for multi agent support, the format should be:
// { [sessionName: string]: { agent, sessionId } }
//
// then /session load can support this to switch session
// /session load <agent:sessionId>

const stateSchema = z
  .object({
    // TODO: makes use of version for auto state migrations
    version: z.literal(1),
    scopes: z.record(
      z.string().min(1), // scopeKey: agent command
      z.object({
        sessions: z.record(
          z.string().min(1), // sessionName
          z.object({
            sessionId: z.string().min(1),
            verbose: z.boolean().optional(),
          }),
        ),
      }),
    ),
  })
  .strict();

type State = z.infer<typeof stateSchema>;
type Scope = State["scopes"][string];
export type StateSession = Scope["sessions"][string];
export type SessionStateStore = ReturnType<typeof createSessionStateStore>;

export function createSessionStateStore(config: Pick<AppConfig, "agent" | "stateFile">) {
  const scopeKey = config.agent.command;

  function readState(): State {
    if (fs.existsSync(config.stateFile)) {
      try {
        const data = fs.readFileSync(config.stateFile, "utf8");
        return stateSchema.parse(JSON.parse(data));
      } catch (e) {
        console.error("[state] readState failed:", e);
      }
    }
    return { version: 1, scopes: {} };
  }

  function writeState(state: State): void {
    fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
    fs.writeFileSync(config.stateFile, JSON.stringify(state, null, 2));
  }

  function ensureScope(state: State): Scope {
    return (state.scopes[scopeKey] ??= { sessions: {} });
  }

  function getSessions() {
    const state = readState();
    return ensureScope(state).sessions;
  }

  function writeSessions(sessions: Scope["sessions"]) {
    const state = readState();
    const scope = ensureScope(state);
    scope.sessions = sessions;
    writeState(state);
  }

  return {
    getSessions,
    getSession(sessionName: string) {
      return getSessions()[sessionName];
    },
    setSession(sessionName: string, patch: StateSession) {
      const sessions = getSessions();
      sessions[sessionName] = { ...sessions[sessionName], ...patch };
      writeSessions(sessions);
    },
    deleteSession(sessionName: string) {
      const sessions = getSessions();
      if (sessions[sessionName]) {
        delete sessions[sessionName];
        writeSessions(sessions);
      }
    },
  };
}
