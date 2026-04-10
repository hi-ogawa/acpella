import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { AsyncQueue } from "../async-queue.ts";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Agent,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";

export type { SessionUpdate };

export class AcpSession {
  sessionId: string;
  conn: ClientSideConnection;
  proc: ChildProcess;
  onUpdate: ((u: SessionUpdate) => void) | undefined;

  constructor(sessionId: string, conn: ClientSideConnection, proc: ChildProcess) {
    this.sessionId = sessionId;
    this.conn = conn;
    this.proc = proc;
  }

  /** Spawn an agent adapter, initialize, and create a session. */
  static async start(command: string, cwd: string): Promise<AcpSession> {
    const [cmd, ...args] = command.trim().split(/\s+/);
    const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"], cwd });

    const stream = ndJsonStream(
      Writable.toWeb(proc.stdin!),
      Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>,
    );

    const session = new AcpSession("", null! as ClientSideConnection, proc);

    const clientImpl: Client = {
      async requestPermission(
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> {
        const first = params.options[0];
        if (!first) return { outcome: { outcome: "cancelled" } };
        return { outcome: { outcome: "selected", optionId: first.optionId } };
      },
      async sessionUpdate(n: SessionNotification): Promise<void> {
        session.onUpdate?.(n.update);
      },
    };

    const conn = new ClientSideConnection((_agent: Agent) => clientImpl, stream);
    await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });

    const { sessionId } = await conn.newSession({ cwd, mcpServers: [] });
    session.sessionId = sessionId;
    session.conn = conn;

    return session;
  }

  /** Send a prompt, yielding SessionUpdate events as they arrive. */
  async *prompt(text: string): AsyncGenerator<SessionUpdate> {
    const queue = new AsyncQueue<SessionUpdate>();
    this.onUpdate = (u) => queue.push(u);
    this.conn
      .prompt({ sessionId: this.sessionId, prompt: [{ type: "text", text }] })
      .finally(() => queue.finish());
    try {
      yield* queue;
    } finally {
      this.onUpdate = undefined;
    }
  }

  /** Kill the agent process. */
  close(): void {
    this.proc.kill();
  }
}
