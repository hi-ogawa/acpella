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
  private connection: ClientSideConnection;
  private child: ChildProcess;
  private setListener: (fn: ((u: SessionUpdate) => void) | undefined) => void;

  private constructor(
    sessionId: string,
    connection: ClientSideConnection,
    child: ChildProcess,
    setListener: (fn: ((u: SessionUpdate) => void) | undefined) => void,
  ) {
    this.sessionId = sessionId;
    this.connection = connection;
    this.child = child;
    this.setListener = setListener;
  }

  /** Spawn an agent adapter, initialize, and create a session. */
  static async start(command: string, cwd: string): Promise<AcpSession> {
    const [cmd, ...args] = command.trim().split(/\s+/);
    // TODO:
    // handle stderr
    // handle process exit
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"], cwd });

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin!),
      Readable.toWeb(child.stdout!) as ReadableStream,
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

    const connection = new ClientSideConnection((_agent: Agent) => clientImpl, stream);
    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    } satisfies InitializeRequest);

    // TODO: somehow need explicit satisfies to have IDE kicks in
    const { sessionId } = await connection.newSession({
      cwd,
      mcpServers: [],
    } satisfies NewSessionRequest);

    return new AcpSession(sessionId, connection, child, (fn) => {
      listener = fn;
    });
  }

  // TODO: pending prompt
  // TODO: cancel prompt
  async *prompt(text: string): AsyncGenerator<SessionUpdate> {
    const queue = new AsyncQueue<SessionUpdate>();
    this.setListener((u) => queue.push(u));
    this.connection
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

  close(): void {
    this.child.kill();
  }
}
