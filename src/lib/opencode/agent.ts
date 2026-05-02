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
import { createOpencodeClient, createOpencodeServer, type ToolPart } from "@opencode-ai/sdk/v2";

async function createOpencodeClientContext({ cwd }: { cwd: string }) {
  const server = await createOpencodeServer({ port: 0, timeout: 10000 });

  return {
    client: createOpencodeClient({ baseUrl: server.url, directory: cwd }),
    async [Symbol.asyncDispose]() {
      server.close();
    },
  };
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
    await using opencode = await createOpencodeClientContext({ cwd: params.cwd });
    const session = await opencode.client.session
      .create({ directory: params.cwd, title: "Acpella OpenCode ACP" }, { throwOnError: true })
      .then((response) => response.data!);
    this.sessions.set(session.id, { cwd: params.cwd });
    return { sessionId: session.id };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    await using opencode = await createOpencodeClientContext({ cwd: params.cwd });
    await opencode.client.session.get(
      { sessionID: params.sessionId, directory: params.cwd },
      { throwOnError: true },
    );
    this.sessions.set(params.sessionId, { cwd: params.cwd });
    return {};
  }

  async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    const cwd = params.cwd ?? process.cwd();
    await using opencode = await createOpencodeClientContext({ cwd });
    const sessions = await opencode.client.session
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

    await using opencode = await createOpencodeClientContext({ cwd: session.cwd });
    const abort = new AbortController();
    const startedTools = new Set<string>();
    const messagePartTypes = new Map<string, "text" | "reasoning">();
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
    const subscription = await opencode.client.global.event({ signal: abort.signal });
    const reader = (async () => {
      for await (const event of subscription.stream) {
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

        if (payload.type === "session.compacted") {
          const props = payload.properties;
          if (props.sessionID === params.sessionId) {
            await this.connection.sessionUpdate({
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "" },
                _meta: {
                  "acpella.opencode": {
                    "session.compacted": true,
                  },
                },
              },
            });
          }
          continue;
        }

        if (payload.type === "message.part.updated") {
          const props = payload.properties;
          if (props.sessionID === params.sessionId) {
            if (props.part.type === "tool") {
              await sendToolUpdate(props.part);
            } else if (props.part.type === "text") {
              messagePartTypes.set(`${props.part.messageID}:${props.part.id}`, props.part.type);
            } else if (props.part.type === "reasoning") {
              messagePartTypes.set(`${props.part.messageID}:${props.part.id}`, props.part.type);
            }
          }
          continue;
        }

        if (payload.type === "message.part.delta") {
          const props = payload.properties;
          if (props.sessionID === params.sessionId) {
            const partType = messagePartTypes.get(`${props.messageID}:${props.partID}`);
            if (partType) {
              await this.connection.sessionUpdate({
                sessionId: params.sessionId,
                update: {
                  sessionUpdate:
                    partType === "reasoning" ? "agent_thought_chunk" : "agent_message_chunk",
                  messageId: props.messageID,
                  content: { type: "text", text: props.delta },
                },
              });
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
      await opencode.client.session.prompt(
        {
          sessionID: params.sessionId,
          directory: session.cwd,
          parts: [{ type: "text", text }],
        },
        { throwOnError: true },
      );
      await lifecycle.promise;
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "usage_update",
          // TODO
          used: 0,
          size: 0,
        },
      });
    } finally {
      abort.abort();
      await reader;
    }

    return { stopReason: "end_turn" };
  }

  async cancel(params: CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      return;
    }

    await using opencode = await createOpencodeClientContext({ cwd: session.cwd });
    await opencode.client.session.abort(
      { sessionID: params.sessionId, directory: session.cwd },
      { throwOnError: true },
    );
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
