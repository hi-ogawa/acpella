import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { AsyncQueue } from "../async-queue.ts";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type SessionNotification,
  type RequestPermissionRequest,
  type Client,
  type InitializeRequest,
  type NewSessionRequest,
  type PromptRequest,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";

// TODO: review slop (NEVER REMOVE THIS COMMENT)

export class AcpManager {
  sessionId: string;
  private connection: ClientSideConnection;
  private child: ChildProcess;
  private listeners: Set<(u: SessionUpdate) => void>;

  private constructor(
    sessionId: string,
    connection: ClientSideConnection,
    child: ChildProcess,
    listeners: Set<(u: SessionUpdate) => void>,
  ) {
    this.sessionId = sessionId;
    this.connection = connection;
    this.child = child;
    this.listeners = listeners;
  }

  /** Spawn an agent adapter, initialize, and create a session. */
  static async start(command: string, cwd: string): Promise<AcpManager> {
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
      async requestPermission(params: RequestPermissionRequest) {
        const first = params.options[0];
        if (!first) {
          return { outcome: { outcome: "cancelled" } };
        }
        return { outcome: { outcome: "selected", optionId: first.optionId } };
      },
      async sessionUpdate(params: SessionNotification) {
        for (const fn of listeners) {
          fn(params.update);
        }
      },
    };

    const connection = new ClientSideConnection(() => client, stream);
    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    } satisfies InitializeRequest);

    // TODO: somehow need explicit satisfies to have IDE kicks in
    const session = await connection.newSession({
      cwd,
      mcpServers: [],
    } satisfies NewSessionRequest);

    return new AcpManager(session.sessionId, connection, child, listeners);
  }

  subscribe(listener: (update: SessionUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // TODO: pending prompt
  // TODO: cancel prompt
  async *prompt(text: string): AsyncGenerator<SessionUpdate> {
    const queue = new AsyncQueue<SessionUpdate>();
    const unsubscribe = this.subscribe((u) => queue.push(u));
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
      unsubscribe();
    }
  }

  close(): void {
    this.child.kill();
  }
}
