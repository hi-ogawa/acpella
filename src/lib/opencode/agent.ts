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

async function getClient<T>(
  cwd: string,
  callback: (client: OpencodeClient) => Promise<T>,
  timing?: Timing,
) {
  timing?.mark("opencode_server_starting");
  const server = await createOpencodeServer({ port: 0, timeout: 10000 });
  timing?.mark("opencode_server_started", { url: server.url });
  try {
    return await callback(createOpencodeClient({ baseUrl: server.url, directory: cwd }));
  } finally {
    server.close();
    timing?.mark("opencode_server_closed");
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
    const timing = createTiming("opencode_acp_new_session", "new");
    timing.mark("new_session_starting");
    return await getClient(
      params.cwd,
      async (client) => {
        timing.mark("session_create_starting");
        const session = await client.session
          .create({ directory: params.cwd, title: "Acpella OpenCode ACP" }, { throwOnError: true })
          .then((response) => response.data!);
        timing.mark("session_created", { sessionId: session.id });
        this.sessions.set(session.id, { cwd: params.cwd });
        timing.summary({ sessionId: session.id });
        return { sessionId: session.id };
      },
      timing,
    );
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const timing = createTiming("opencode_acp_load_session", params.sessionId);
    timing.mark("load_session_starting");
    await getClient(
      params.cwd,
      async (client) => {
        timing.mark("session_get_starting");
        await client.session.get(
          { sessionID: params.sessionId, directory: params.cwd },
          { throwOnError: true },
        );
        timing.mark("session_loaded");
        timing.summary();
      },
      timing,
    );
    this.sessions.set(params.sessionId, { cwd: params.cwd });
    return {};
  }

  async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    const cwd = params.cwd ?? process.cwd();
    const timing = createTiming("opencode_acp_list_sessions", "list");
    timing.mark("list_sessions_starting");
    return await getClient(
      cwd,
      async (client) => {
        timing.mark("session_list_starting");
        const sessions = await client.session
          .list({ directory: cwd, roots: true }, { throwOnError: true })
          .then((response) => response.data ?? []);
        timing.mark("session_listed", { count: sessions.length });
        timing.summary();
        return {
          sessions: sessions.map((session) => ({
            sessionId: session.id,
            cwd: session.directory,
            title: session.title,
            updatedAt: new Date(session.time.updated).toISOString(),
          })),
        };
      },
      timing,
    );
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
    const timing = createTiming("opencode_acp_prompt", params.sessionId);

    // TODO: log unsupported part types
    const text =
      params.prompt
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("") || "(empty)";
    timing.mark("prompt_received", { chars: text.length });

    await getClient(
      session.cwd,
      async (client) => {
        const abort = new AbortController();
        const startedTools = new Set<string>();
        const messagePartTypes = new Map<string, "text" | "reasoning">();
        let sawBusy = false;
        let sawFirstDelta = false;
        let sawFirstPartUpdate = false;
        let sawFirstTool = false;
        let deltaCount = 0;
        let deltaChars = 0;
        let lastDeltaAt: number | undefined;
        const deltaGaps: number[] = [];
        const lifecycle = Promise.withResolvers<void>();
        const sendToolUpdate = async (part: ToolPart) => {
          if (!sawFirstTool) {
            sawFirstTool = true;
            timing.mark("first_tool_update", { tool: part.tool, status: part.state.status });
          }
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
        timing.mark("event_subscribe_starting");
        const subscription = await client.global.event({ signal: abort.signal });
        timing.mark("event_subscribed");
        const reader = (async () => {
          for await (const event of subscription.stream) {
            const payload = event.payload;
            if (payload.type === "session.status") {
              const props = payload.properties;
              if (props.sessionID === params.sessionId) {
                if (props.status.type === "busy") {
                  sawBusy = true;
                  timing.mark("session_busy");
                }
                if (props.status.type === "idle" && sawBusy) {
                  timing.mark("session_idle");
                  lifecycle.resolve();
                }
              }
              continue;
            }

            if (payload.type === "session.compacted") {
              const props = payload.properties;
              if (props.sessionID === params.sessionId) {
                // TODO: surface compaction
                // await this.connection.sessionUpdate({
                //   sessionId: params.sessionId,
                //   update: {
                //     sessionUpdate: "usage_update",
                //     used: 0,
                //     size: 0,
                //   },
                // });
              }
              continue;
            }

            if (payload.type === "message.part.updated") {
              const props = payload.properties;
              if (props.sessionID === params.sessionId) {
                if (!sawFirstPartUpdate) {
                  sawFirstPartUpdate = true;
                  timing.mark("first_part_update", { type: props.part.type });
                }
                if (props.part.type === "tool") {
                  await sendToolUpdate(props.part);
                } else if (props.part.type === "text") {
                  messagePartTypes.set(`${props.part.messageID}:${props.part.id}`, props.part.type);
                } else if (props.part.type === "reasoning") {
                  messagePartTypes.set(`${props.part.messageID}:${props.part.id}`, props.part.type);
                } else if (props.part.type === "compaction") {
                  // TODO
                }
              }
              continue;
            }

            if (payload.type === "message.part.delta") {
              const props = payload.properties;
              if (props.sessionID === params.sessionId) {
                const now = performance.now();
                deltaCount += 1;
                deltaChars += props.delta.length;
                if (lastDeltaAt !== undefined) {
                  deltaGaps.push(Math.round(now - lastDeltaAt));
                }
                lastDeltaAt = now;
                if (!sawFirstDelta) {
                  sawFirstDelta = true;
                  timing.mark("first_delta", { chars: props.delta.length });
                }
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
          timing.mark("session_prompt_starting");
          const response = await client.session.prompt(
            {
              sessionID: params.sessionId,
              directory: session.cwd,
              parts: [{ type: "text", text }],
            },
            { throwOnError: true },
          );
          timing.mark("session_prompt_resolved");

          await lifecycle.promise;
          timing.mark("lifecycle_completed");
          const info = response.data.info;
          const used = info.tokens.input + info.tokens.cache.read;
          const total = used + info.tokens.output + info.tokens.reasoning;
          await this.connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "usage_update",
              // TODO
              used,
              size: Math.max(used, total),
              cost: { amount: info.cost, currency: "USD" },
            },
          });
          timing.mark("usage_update_sent", { used, total, cost: info.cost });
        } finally {
          abort.abort();
          await reader;
          timing.summary({ deltaCount, deltaChars, deltaGaps: summarizeGaps(deltaGaps) });
        }
      },
      timing,
    );

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

type Timing = ReturnType<typeof createTiming>;

function createTiming(label: string, sessionId: string) {
  const enabled = process.env.OPENCODE_ACP_TIMING === "1";
  const start = performance.now();
  const marks: Array<{ name: string; ms: number; extra?: Record<string, unknown> }> = [];

  function mark(name: string, extra?: Record<string, unknown>) {
    if (!enabled) {
      return;
    }
    const ms = Math.round(performance.now() - start);
    marks.push({ name, ms, extra });
    console.error(`[timing:${label}] ${name} +${ms}ms ${formatTimingExtra(extra)}`.trim());
  }

  function summary(extra?: Record<string, unknown>) {
    if (!enabled) {
      return;
    }
    const totalMs = Math.round(performance.now() - start);
    console.error(
      `[timing:${label}] summary ${JSON.stringify({ sessionId, totalMs, marks, ...extra })}`,
    );
  }

  return { mark, summary };
}

function formatTimingExtra(extra: Record<string, unknown> | undefined) {
  return extra ? JSON.stringify(extra) : "";
}

function summarizeGaps(gaps: number[]) {
  if (gaps.length === 0) {
    return { count: 0, min: 0, max: 0, avg: 0, values: [] };
  }
  const total = gaps.reduce((sum, gap) => sum + gap, 0);
  return {
    count: gaps.length,
    min: Math.min(...gaps),
    max: Math.max(...gaps),
    avg: Math.round(total / gaps.length),
    values: gaps,
  };
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
