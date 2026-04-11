import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { AsyncQueue } from "../async-queue.ts";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";

// TODO: review slop (NEVER REMOVE THIS COMMENT)

/** Spawn an agent adapter, initialize, and create a session. */
export async function startAcpAgent(command: string, cwd: string) {
  const [cmd, ...args] = command.trim().split(/\s+/);
  // TODO:
  // handle stderr
  // handle process exit
  const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"], cwd });

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin!),
    Readable.toWeb(child.stdout!) as ReadableStream,
  );

  const listeners = new Set<(u: SessionUpdate) => void>();

  const client: Client = {
    async requestPermission(params) {
      const first = params.options[0];
      if (!first) {
        return { outcome: { outcome: "cancelled" } };
      }
      return { outcome: { outcome: "selected", optionId: first.optionId } };
    },
    async sessionUpdate(params) {
      for (const fn of listeners) {
        fn(params.update);
      }
    },
  };

  const connection = new ClientSideConnection(() => client, stream);
  const initializeResposne = await connection.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
  });
  const { agentInfo } = initializeResposne;

  // TODO: support restore session
  // manager should expose listSessions, newSession, loadSession
  const newSessionResponse = await connection.newSession({
    cwd,
    mcpServers: [],
  });
  const { sessionId } = newSessionResponse;

  const manager = {
    agentInfo,
    sessionId,
    subscribe(listener: (update: SessionUpdate) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // TODO: pending prompt
    // TODO: cancel prompt
    prompt(text: string) {
      const queue = new AsyncQueue<SessionUpdate>();
      const unsubscribe = manager.subscribe((u) => queue.push(u));
      const promise = (async () => {
        try {
          await connection.prompt({
            sessionId,
            prompt: [{ type: "text", text }],
          });
          queue.finish();
        } catch (e) {
          queue.finish(e);
          throw e;
        } finally {
          unsubscribe();
        }
      })();
      return {
        promise,
        queue,
      };
    },
    close() {
      child.kill();
    },
  };

  return manager;
}

export type AcpManager = Awaited<ReturnType<typeof startAcpAgent>>;
