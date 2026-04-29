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
  type ToolKind,
  type ToolCall,
} from "@agentclientprotocol/sdk";
import {
  createOpencodeClient,
  createOpencodeServer,
  type OpencodeClient,
  type ToolPart,
} from "@opencode-ai/sdk/v2";

async function getClient<T>(cwd: string, callback: (client: OpencodeClient) => Promise<T>) {
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
    return await getClient(params.cwd, async (client) => {
      const session = await client.session
        .create({ directory: params.cwd, title: "Acpella OpenCode ACP" }, { throwOnError: true })
        .then((response) => response.data!);
      this.sessions.set(session.id, { cwd: params.cwd });
      return { sessionId: session.id };
    });
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    await getClient(params.cwd, async (client) => {
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
    return await getClient(cwd, async (client) => {
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

    // TODO: log unsupported part types
    const text =
      params.prompt
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("") || "(empty)";

    await getClient(session.cwd, async (client) => {
      const abort = new AbortController();
      const startedTools = new Set<string>();
      let sawBusy = false;
      const lifecycle = Promise.withResolvers<void>();
      const sendToolUpdate = async (part: ToolPart) => {
        const sessionUpdate = (() => {
          if (!startedTools.has(part.callID)) {
            startedTools.add(part.callID);
            return "tool_call";
          }
          return "tool_call_update";
        })();
        await this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: sessionUpdate as "tool_call",
            ...formatToolCall(part),
          },
        });
      };
      const subscription = await client.global.event({ signal: abort.signal });
      const reader = (async () => {
        for await (const event of subscription.stream) {
          // TODO: surface EventSessionCompacted
          const payload = event.payload;
          if (payload.type === "session.status") {
            const props = payload.properties;
            if (props.sessionID === params.sessionId) {
              if (props.status.type === "busy") {
                sawBusy = true;
              }
              if (props.status.type === "idle" && sawBusy) {
                lifecycle.resolve();
              }
            }
            continue;
          }

          if (payload.type === "message.part.updated") {
            const props = payload.properties;
            if (props.sessionID === params.sessionId && props.part.type === "tool") {
              await sendToolUpdate(props.part);
            }
            continue;
          }

          if (payload.type === "message.part.delta") {
            const props = payload.properties;
            if (props.sessionID === params.sessionId && props.field === "text" && props.delta) {
              const message = await client.session
                .message(
                  {
                    sessionID: props.sessionID,
                    messageID: props.messageID,
                    directory: session.cwd,
                  },
                  { throwOnError: true },
                )
                .then((result) => result.data)
                // TODO: log error
                .catch(() => undefined);
              if (message?.info.role === "assistant") {
                const part = message.parts.find((item) => item.id === props.partID);
                if (part?.type === "text" || part?.type === "reasoning") {
                  await this.connection.sessionUpdate({
                    sessionId: params.sessionId,
                    update: {
                      sessionUpdate:
                        part.type === "reasoning" ? "agent_thought_chunk" : "agent_message_chunk",
                      messageId: props.messageID,
                      content: { type: "text", text: props.delta },
                    },
                  });
                }
              }
            }
          }
        }
      })().catch((error) => {
        if (!abort.signal.aborted) {
          lifecycle.reject(error);
          throw error;
        }
      });

      try {
        const response = await client.session.prompt(
          {
            sessionID: params.sessionId,
            directory: session.cwd,
            parts: [{ type: "text", text }],
          },
          { throwOnError: true },
        );

        await lifecycle.promise;
        const info = response.data.info;
        const used = info.tokens.input + info.tokens.cache.read;
        const total = used + info.tokens.output + info.tokens.reasoning;
        await this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "usage_update",
            used,
            size: Math.max(used, total),
            cost: { amount: info.cost, currency: "USD" },
          },
        });
      } finally {
        abort.abort();
        await reader;
      }
    });

    return { stopReason: "end_turn" };
  }

  async cancel(params: CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      return;
    }

    await getClient(session.cwd, async (client) => {
      await client.session.abort(
        { sessionID: params.sessionId, directory: session.cwd },
        { throwOnError: true },
      );
    });
  }
}

const TOOL_KIND_BY_NAME: Record<string, ToolKind> = {
  bash: "execute",
  glob: "search",
  grep: "search",
  read: "read",
  webfetch: "fetch",
  write: "edit",
  edit: "edit",
  patch: "edit",
};

function formatToolCall(part: ToolPart): ToolCall {
  const base: Pick<ToolCall, "toolCallId" | "kind" | "rawInput"> = {
    kind: TOOL_KIND_BY_NAME[part.tool.toLowerCase()] ?? "other",
    toolCallId: part.callID,
    rawInput: part.state.input,
  };
  switch (part.state.status) {
    case "pending": {
      return {
        ...base,
        title: part.tool,
        status: "pending",
      };
    }
    case "running": {
      return {
        ...base,
        title: part.state.title || part.tool,
        status: "in_progress",
      };
    }
    case "completed": {
      return {
        ...base,
        title: part.state.title,
        status: "completed",
        rawOutput: { output: part.state.output, metadata: part.state.metadata },
      };
    }
    case "error": {
      return {
        ...base,
        title: part.tool,
        status: "failed",
        rawOutput: { error: part.state.error, metadata: part.state.metadata },
      };
    }
  }
}

function main() {
  const input = Writable.toWeb(process.stdout);
  const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(input, output);
  new AgentSideConnection((conn) => new OpencodeAgent(conn), stream);
}

main();
