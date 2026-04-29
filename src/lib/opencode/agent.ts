import { Readable, Writable } from "node:stream";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type AuthenticateRequest,
  type AuthenticateResponse,
  type CancelNotification,
  type CloseSessionRequest,
  type CloseSessionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
} from "@agentclientprotocol/sdk";
import {
  createOpencodeClient,
  createOpencodeServer,
  type EventMessagePartDelta,
  type GlobalEvent,
  type OpencodeClient,
  type Part,
} from "@opencode-ai/sdk/v2";

async function withOpenCode<T>(cwd: string, callback: (client: OpencodeClient) => Promise<T>) {
  const server = await createOpencodeServer({ port: 0, timeout: 10000 });
  try {
    return await callback(createOpencodeClient({ baseUrl: server.url, directory: cwd }));
  } finally {
    server.close();
  }
}

class OpencodeAgent implements Agent {
  private connection: AgentSideConnection;
  private sessions = new Map<string, { cwd: string }>();

  constructor(connection: AgentSideConnection) {
    this.connection = connection;
  }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    return await withOpenCode(params.cwd, async (client) => {
      const session = await client.session
        .create({ directory: params.cwd, title: "Acpella OpenCode ACP" }, { throwOnError: true })
        .then((response) => response.data!);
      this.sessions.set(session.id, { cwd: params.cwd });
      return { sessionId: session.id };
    });
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    await withOpenCode(params.cwd, async (client) => {
      await client.session.get(
        { sessionID: params.sessionId, directory: params.cwd },
        { throwOnError: true },
      );
    });
    this.sessions.set(params.sessionId, { cwd: params.cwd });
    return {};
  }

  async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    const cwd = params.cwd ?? process.cwd();
    return await withOpenCode(cwd, async (client) => {
      const sessions = await client.session
        .list({ directory: cwd, roots: true }, { throwOnError: true })
        .then((response) => response.data ?? []);
      return {
        sessions: sessions.map((session) => ({
          sessionId: session.id,
          cwd: session.directory,
          title: session.title,
          updatedAt: new Date(session.time.updated).toISOString(),
        })),
      };
    });
  }

  async unstable_closeSession(_params: CloseSessionRequest): Promise<CloseSessionResponse> {
    return {};
  }

  async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
    return {};
  }

  async setSessionMode(_params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    return {};
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`unknown session: ${params.sessionId}`);
    }

    const text =
      params.prompt
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("") || "(empty)";

    const responseText = await withOpenCode(session.cwd, async (client) => {
      const abort = new AbortController();
      const emitted = new Map<string, string>();
      const subscription = await client.global.event({ signal: abort.signal });
      const reader = (async () => {
        for await (const event of subscription.stream) {
          const payload = (event as GlobalEvent).payload;
          if (payload.type !== "message.part.delta") {
            continue;
          }
          const props: EventMessagePartDelta["properties"] = payload.properties;
          if (props.sessionID !== params.sessionId || props.field !== "text") {
            continue;
          }
          if (!props.delta) {
            continue;
          }
          const previous = emitted.get(props.partID) ?? "";
          const next = previous + props.delta;
          if (next === previous) {
            continue;
          }
          emitted.set(props.partID, next);
          await this.connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: props.delta },
            },
          });
        }
      })().catch((error: unknown) => {
        if (!abort.signal.aborted) {
          throw error;
        }
      });

      const response = await client.session
        .prompt(
          {
            sessionID: params.sessionId,
            directory: session.cwd,
            parts: [{ type: "text", text }],
          },
          { throwOnError: true },
        )
        .then((result) => result.data!);

      abort.abort();
      await reader;
      return (
        response.parts
          .map((part: Part) => (part.type === "text" || part.type === "reasoning" ? part.text : ""))
          .filter(Boolean)
          .join("") || "(empty)"
      );
    });

    if (responseText) {
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: responseText },
        },
      });
    }

    return { stopReason: "end_turn" };
  }

  async cancel(_params: CancelNotification): Promise<void> {}
}

function main() {
  const input = Writable.toWeb(process.stdout);
  const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(input, output);
  new AgentSideConnection((conn) => new OpencodeAgent(conn), stream);
}

main();
