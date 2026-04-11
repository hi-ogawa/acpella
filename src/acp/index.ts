import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { AsyncQueue } from "../async-queue.ts";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
  type SessionUpdate,
  type ListSessionsResponse,
} from "@agentclientprotocol/sdk";

// TODO: review slop (NEVER REMOVE THIS COMMENT)

// Design: session ownership
//
//   Option A: startAcpAgent → manager, manager.newSession() → session
//     manager owns process lifecycle (spawn + initialize).
//     session owns conversation lifecycle (newSession + prompt + close).
//     The ACP protocol allows multiple sessions per process.
//
//   Option B (current): startAcpAgent → { newSession, loadSession }, each spawns its own process.
//     Simpler. acpx does the same — one process per named session.
//
// Option B was chosen for simplicity, matching acpx's real-world behavior.

export async function startAcpManager(options: { command: string; cwd: string }) {
  return {
    async newSession(sessionOptions: { sessionCwd: string }) {
      const agent = await spawnAgent(options);
      const session = await agent.connection.newSession({
        cwd: sessionOptions.sessionCwd,
        mcpServers: [],
      });
      const sessionId = session.sessionId;
      return createSession({ agent, sessionId });
    },
    async loadSession(sessionOptions: { sessionCwd: string; sessionId: string }) {
      const agent = await spawnAgent(options);
      const { sessionId } = sessionOptions;
      await agent.connection.loadSession({
        sessionId,
        cwd: sessionOptions.sessionCwd,
        mcpServers: [],
      });
      return createSession({ agent, sessionId });
    },
    async listSessions(): Promise<ListSessionsResponse> {
      const agent = await spawnAgent(options);
      try {
        return await agent.connection.listSessions({ cwd: options.cwd });
      } finally {
        agent.child.kill();
      }
    },
  };
}

type SpanwedAgent = Awaited<ReturnType<typeof spawnAgent>>;

async function spawnAgent({ command, cwd }: { command: string; cwd: string }) {
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
      // acpx --approve-all like behavior
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
  await connection.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
  });

  function subscribe(listener: (update: SessionUpdate) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { child, connection, subscribe };
}

async function createSession(options: { agent: SpanwedAgent; sessionId: string }) {
  const { agent } = options;
  return {
    sessionId: options.sessionId,
    // TODO: ensure single in-flight prompt per session
    // TODO: cancel prompt
    prompt(text: string) {
      const queue = new AsyncQueue<SessionUpdate>();
      const unsubscribe = agent.subscribe((u) => queue.push(u));
      const promise = agent.connection.prompt({
        sessionId: options.sessionId,
        prompt: [{ type: "text", text }],
      });
      promise
        .then(
          () => queue.finish(),
          (e) => queue.finish(e),
        )
        .finally(() => {
          unsubscribe();
        });
      return { promise, queue };
    },
    close() {
      agent.child.kill();
    },
  };
}
