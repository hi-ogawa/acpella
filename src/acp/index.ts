import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { AsyncQueue } from "../async-queue.ts";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Agent,
  type Client,
  type InitializeRequest,
  type NewSessionRequest,
  type PromptRequest,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";

// TODO: review slop (NEVER REMOVE THIS COMMENT)

export class AcpSession {
  sessionId: string;
  private conn: ClientSideConnection;
  private proc: ChildProcess;
  private setListener: (fn: ((u: SessionUpdate) => void) | undefined) => void;

  private constructor(
    sessionId: string,
    conn: ClientSideConnection,
    proc: ChildProcess,
    setListener: (fn: ((u: SessionUpdate) => void) | undefined) => void,
  ) {
    this.sessionId = sessionId;
    this.conn = conn;
    this.proc = proc;
    this.setListener = setListener;
  }

  /** Spawn an agent adapter, initialize, and create a session. */
  static async start(command: string, cwd: string): Promise<AcpSession> {
    const [cmd, ...args] = command.trim().split(/\s+/);
    // TODO:
    // handle stderr
    // handle process exit
    const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"], cwd });

    const stream = ndJsonStream(
      Writable.toWeb(proc.stdin!),
      Readable.toWeb(proc.stdout!) as ReadableStream,
    );

    // listener lives here in the closure — clientImpl closes over it directly,
    // no forward reference to the session needed.
    let listener: ((u: SessionUpdate) => void) | undefined;

    const clientImpl: Client = {
      async requestPermission(params) {
        const first = params.options[0];
        if (!first) return { outcome: { outcome: "cancelled" } };
        return { outcome: { outcome: "selected", optionId: first.optionId } };
      },
      async sessionUpdate(n) {
        listener?.(n.update);
      },
    };

    const conn = new ClientSideConnection((_agent: Agent) => clientImpl, stream);
    await conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    } satisfies InitializeRequest);

    // TODO: somehow need explicit satisfies to have IDE kicks in
    const { sessionId } = await conn.newSession({
      cwd,
      mcpServers: [],
    } satisfies NewSessionRequest);

    return new AcpSession(sessionId, conn, proc, (fn) => {
      listener = fn;
    });
  }

  /** Send a prompt, yielding SessionUpdate events as they arrive. */
  async *prompt(text: string): AsyncGenerator<SessionUpdate> {
    const queue = new AsyncQueue<SessionUpdate>();
    this.setListener((u) => queue.push(u));
    this.conn
      .prompt({
        sessionId: this.sessionId,
        prompt: [{ type: "text", text }],
      } satisfies PromptRequest)
      .then(
        () => queue.finish(),
        (err) => queue.error(err),
      );
    try {
      yield* queue;
    } finally {
      this.setListener(undefined);
    }
  }

  /** Kill the agent process. */
  close(): void {
    this.proc.kill();
  }
}
