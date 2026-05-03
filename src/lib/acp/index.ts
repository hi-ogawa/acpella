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
import { objectPickBy, AsyncIterableQueue } from "../../utils/index.ts";

// we spawn a process per session instead of per acp command for simplicity.
// this is likey more robust without acp agent capability assumption
// and process startup time is negligible compared to LLM interaction itself

export class AgentManager {
  options: {
    command: string;
    cwd: string;
  };

  constructor(options: AgentManager["options"]) {
    this.options = options;
  }

  // TODO:
  // cwd and sessionCwd are always same
  // but they are explicitly specified for now
  async newSession({ sessionCwd }: { sessionCwd: string }) {
    const agent = await spawnAgent(this.options);
    const response = await agent.connection.newSession({
      cwd: sessionCwd,
      mcpServers: [],
    });
    return new AgentSessionProcess(agent, response.sessionId);
  }

  async loadSession({ sessionCwd, sessionId }: { sessionCwd: string; sessionId: string }) {
    const agent = await spawnAgent(this.options);
    await agent.connection.loadSession({
      sessionId,
      cwd: sessionCwd,
      mcpServers: [],
    });
    return new AgentSessionProcess(agent, sessionId);
  }

  async closeSession({ sessionId }: { sessionId: string }): Promise<void> {
    const agent = await spawnAgent(this.options);
    try {
      await agent.connection.unstable_closeSession({ sessionId });
    } finally {
      agent.stop();
    }
  }

  async listSessions(): Promise<ListSessionsResponse> {
    const agent = await spawnAgent(this.options);
    try {
      return await agent.connection.listSessions({ cwd: this.options.cwd });
    } finally {
      agent.stop();
    }
  }
}

type AgentProcess = Awaited<ReturnType<typeof spawnAgent>>;

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
    child,
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

export class AgentSessionProcess {
  agent: AgentProcess;
  sessionId: string;

  constructor(agent: AgentProcess, sessionId: string) {
    this.agent = agent;
    this.sessionId = sessionId;
  }

  stop() {
    this.agent.stop();
  }

  prompt(text: string) {
    return promptStream(this.agent, {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  async cancel(): Promise<void> {
    await this.agent.connection.cancel({ sessionId: this.sessionId });
  }
}

function promptStream(agent: AgentProcess, request: PromptRequest) {
  const queue = new AsyncIterableQueue<SessionUpdate>();
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
