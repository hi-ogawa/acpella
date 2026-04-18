import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
  type SessionUpdate,
  type ListSessionsResponse,
} from "@agentclientprotocol/sdk";
import { AsyncQueue } from "../lib/async-queue.ts";
import { objectPickBy } from "../lib/utils.ts";

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
    async closeSession(sessionOptions: { sessionId: string }): Promise<void> {
      const agent = await spawnAgent(options);
      try {
        await agent.connection.unstable_closeSession({ sessionId: sessionOptions.sessionId });
      } finally {
        agent.child.kill();
      }
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
export type AgentSession = Awaited<ReturnType<typeof createSession>>;

async function spawnAgent({ command, cwd }: { command: string; cwd: string }) {
  const [cmd, ...args] = command.trim().split(/\s+/);
  const safeEnvs = objectPickBy(
    process.env,
    (_, k) => typeof k === "string" && !k.startsWith("ACPELLA_"),
  );
  const child = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd,
    env: safeEnvs,
  });
  const exitPromise = createExitPromise(child);
  if (child.stderr) {
    pipeAgentStderr(child.stderr);
  }

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
  try {
    await Promise.race([
      connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      }),
      exitPromise.promise,
    ]);
  } finally {
    exitPromise.cleanup();
  }

  function subscribe(listener: (update: SessionUpdate) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { child, connection, subscribe };
}

function createExitPromise(child: ChildProcess): {
  promise: Promise<void>;
  cleanup: () => void;
} {
  const done = Promise.withResolvers<void>();
  const onError = (error: Error) => {
    done.reject(new Error(`ACP agent failed to start: ${error.message}`));
  };
  const onExit = (code: number | null) => {
    done.reject(new Error(`ACP agent exited with code=${code ?? "<unknown>"}`));
  };
  child.once("error", onError);
  child.once("exit", onExit);
  return {
    promise: done.promise,
    cleanup() {
      child.off("error", onError);
      child.off("exit", onExit);
    },
  };
}

function pipeAgentStderr(stderr: Readable): void {
  let buffered = "";
  stderr.setEncoding("utf8");
  stderr.on("data", (chunk) => {
    buffered += String(chunk);
    let newlineIndex = buffered.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffered.slice(0, newlineIndex).replace(/\r$/, "");
      console.error(`[acp:stderr] ${line}`);
      buffered = buffered.slice(newlineIndex + 1);
      newlineIndex = buffered.indexOf("\n");
    }
  });
  stderr.on("end", () => {
    if (buffered) {
      console.error(`[acp:stderr] ${buffered.replace(/\r$/, "")}`);
    }
  });
}

async function createSession(options: { agent: SpanwedAgent; sessionId: string }) {
  const { agent } = options;
  return {
    sessionId: options.sessionId,
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
    async cancel(): Promise<void> {
      await agent.connection.cancel({ sessionId: options.sessionId });
    },
    close() {
      agent.child.kill();
    },
  };
}
