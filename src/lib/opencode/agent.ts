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
  type SessionUpdate,
  type ToolKind,
} from "@agentclientprotocol/sdk";
import {
  createOpencodeClient,
  createOpencodeServer,
  type OpencodeClient,
  type Part,
  type ToolPart,
} from "@opencode-ai/sdk/v2";
import { sleep } from "../../utils/index.ts";

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

    const response = await withOpenCode(session.cwd, async (client) => {
      const abort = new AbortController();
      const emitted = new Map<string, string>();
      const startedTools = new Set<string>();
      let lastRelevantEventAt = Date.now();
      const subscription = await client.global.event({ signal: abort.signal });
      const reader = (async () => {
        for await (const event of subscription.stream) {
          const payload = event.payload;
          if (payload.type === "message.part.updated") {
            const props = payload.properties;
            if (props.sessionID === params.sessionId && props.part.type === "tool") {
              lastRelevantEventAt = Date.now();
              await this.sendToolUpdate(params.sessionId, props.part, startedTools);
            }
            continue;
          }

          if (payload.type !== "message.part.delta") {
            continue;
          }
          const props = payload.properties;
          if (props.sessionID !== params.sessionId || props.field !== "text") {
            continue;
          }
          if (!props.delta) {
            continue;
          }
          const message = await client.session
            .message(
              { sessionID: props.sessionID, messageID: props.messageID, directory: session.cwd },
              { throwOnError: true },
            )
            .then((result) => result.data)
            .catch(() => undefined);
          if (!message || message.info.role !== "assistant") {
            continue;
          }
          const part = message.parts.find((item) => item.id === props.partID);
          if (part?.type !== "text" && part?.type !== "reasoning") {
            continue;
          }
          const previous = emitted.get(props.partID) ?? "";
          const next = previous + props.delta;
          if (next === previous) {
            continue;
          }
          emitted.set(props.partID, next);
          lastRelevantEventAt = Date.now();
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
      })().catch((error) => {
        if (!abort.signal.aborted) {
          throw error;
        }
      });

      try {
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

        await waitForEventIdle(() => lastRelevantEventAt, abort.signal);
        await this.emitMissingResponseSuffixes(
          params.sessionId,
          response.info.id,
          response.parts,
          emitted,
        );

        return {
          info: response.info,
        };
      } finally {
        abort.abort();
        await reader;
      }
    });

    const info = response.info;
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

    return { stopReason: "end_turn" };
  }

  async cancel(params: CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      return;
    }

    await withOpenCode(session.cwd, async (client) => {
      await client.session.abort(
        { sessionID: params.sessionId, directory: session.cwd },
        { throwOnError: true },
      );
    });
  }

  private async sendToolUpdate(sessionId: string, part: ToolPart, startedTools: Set<string>) {
    if (!startedTools.has(part.callID)) {
      startedTools.add(part.callID);
      await this.connection.sessionUpdate({
        sessionId,
        update: formatToolCall(part, "tool_call"),
      });
    }

    await this.connection.sessionUpdate({
      sessionId,
      update: formatToolCall(part, "tool_call_update"),
    });
  }

  private async emitMissingResponseSuffixes(
    sessionId: string,
    messageId: string,
    parts: Part[],
    emitted: Map<string, string>,
  ) {
    for (const part of parts) {
      if (part.type !== "text" && part.type !== "reasoning") {
        continue;
      }
      const previous = emitted.get(part.id) ?? "";
      const suffix = part.text.startsWith(previous) ? part.text.slice(previous.length) : part.text;
      if (!suffix) {
        continue;
      }
      emitted.set(part.id, previous + suffix);
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: part.type === "reasoning" ? "agent_thought_chunk" : "agent_message_chunk",
          messageId,
          content: { type: "text", text: suffix },
        },
      });
    }
  }
}

async function waitForEventIdle(
  getLastEventAt: () => number,
  signal: AbortSignal,
  idleMs = 250,
  maxMs = 1500,
) {
  const startedAt = Date.now();
  while (!signal.aborted) {
    const elapsed = Date.now() - startedAt;
    const idleFor = Date.now() - getLastEventAt();
    if (idleFor >= idleMs || elapsed >= maxMs) {
      return;
    }
    await sleep(Math.min(idleMs - idleFor, maxMs - elapsed));
  }
}

const TOOL_KIND_BY_NAME: Record<string, ToolKind> = {
  bash: "execute",
  edit: "edit",
  glob: "search",
  grep: "search",
  patch: "edit",
  read: "read",
  webfetch: "fetch",
  write: "edit",
};

function formatToolCall(
  part: ToolPart,
  sessionUpdate: "tool_call" | "tool_call_update",
): SessionUpdate {
  const kind = TOOL_KIND_BY_NAME[part.tool.toLowerCase()] ?? "other";
  const base = {
    sessionUpdate,
    toolCallId: part.callID,
    kind,
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
