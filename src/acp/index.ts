import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
  type SessionUpdate,
  type ListSessionsResponse,
  type PromptRequest,
} from "@agentclientprotocol/sdk";
import { AsyncQueue } from "../lib/async-queue.ts";
import { objectPickBy } from "../lib/utils.ts";

// we spawn a process per session instead of per acp command for simplicity.
// this is likey more robust without acp agent capability assumption
// and process startup time is negligible compared to LLM interaction itself

type AgentManagerOptions = {
  command: string;
  cwd: string;
};

export class AgentManager {
  option: AgentManagerOptions;

  constructor(options: AgentManagerOptions) {
    this.option = options;
  }

  async newSession(sessionOptions: { sessionCwd: string }) {
    const agent = await spawnAgent(this.option);
    const response = await agent.connection.newSession({
      cwd: sessionOptions.sessionCwd,
      mcpServers: [],
    });
    return toSessionProcess(agent, response.sessionId);
  }

  async loadSession(sessionOptions: { sessionCwd: string; sessionId: string }) {
    const agent = await spawnAgent(this.option);
    const { sessionId } = sessionOptions;
    await agent.connection.loadSession({
      sessionId,
      cwd: sessionOptions.sessionCwd,
      mcpServers: [],
    });
    return toSessionProcess(agent, sessionId);
  }

  async closeSession({ sessionId }: { sessionId: string }): Promise<void> {
    const agent = await spawnAgent(this.option);
    try {
      await agent.connection.unstable_closeSession({ sessionId });
    } finally {
      agent.stop();
    }
  }

  async listSessions(): Promise<ListSessionsResponse> {
    const agent = await spawnAgent(this.option);
    try {
      return await agent.connection.listSessions({ cwd: this.option.cwd });
    } finally {
      agent.stop();
    }
  }
}

export type AgentProcess = Awaited<ReturnType<typeof spawnAgent>>;
export type AgentSessionProcess = Awaited<ReturnType<typeof toSessionProcess>>;

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
    const stream = Readable.toWeb(child.stderr) as ReadableStream;
    void stream.pipeThrough(new TextDecoderStream()).pipeTo(
      new WritableStream({
        write(chunk) {
          console.error(`[acp:stderr] ${chunk}`);
        },
      }),
    );
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

  return {
    connection,
    subscribe,
    stop() {
      child.kill();
    },
  };
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

async function toSessionProcess(agent: AgentProcess, sessionId: string) {
  return {
    ...agent,
    sessionId,
    prompt(text: string) {
      return promptAgent(agent, {
        sessionId,
        prompt: [{ type: "text", text }],
      });
    },
    async cancel(): Promise<void> {
      await agent.connection.cancel({ sessionId });
    },
  };
}

function promptAgent(agent: AgentProcess, request: PromptRequest) {
  const queue = new AsyncQueue<SessionUpdate>();
  const unsubscribe = agent.subscribe((u) => queue.push(u));
  const promise = agent.connection.prompt(request);
  promise
    .then(
      () => queue.finish(),
      (e) => queue.finish(e),
    )
    .finally(() => {
      unsubscribe();
    });
  return { promise, consume: () => queue.consume() };
}
