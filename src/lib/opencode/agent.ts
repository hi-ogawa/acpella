import { Readable, Writable } from "node:stream";
import { parseArgs } from "node:util";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type CancelNotification,
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
  type ToolKind,
  type ToolCall,
} from "@agentclientprotocol/sdk";
import {
  createOpencodeClient,
  createOpencodeServer,
  type GlobalEvent,
  type OpencodeClient,
  type Part,
  type Session,
  type SessionPromptResponse,
  type ToolPart,
} from "@opencode-ai/sdk/v2";

type OpencodeServer = Awaited<ReturnType<typeof createOpencodeServer>>;

type OpencodeAcpAgentOptions = {
  model?: string;
};

class OpencodeAcpAgent implements Agent {
  private server?: OpencodeServer;
  private sessions = new Map<string, Session>();

  constructor(
    private connection: AgentSideConnection,
    private options: OpencodeAcpAgentOptions,
  ) {}

  private async getServer(): Promise<OpencodeServer> {
    // Match OpenCode's ACP mode so interactive-only tools like question are not registered.
    // https://github.com/anomalyco/opencode/blob/b5aed287cae33f5cbfd1e4f512869faa93f82507/packages/opencode/src/cli/cmd/acp.ts#L24
    process.env.OPENCODE_CLIENT = "acp";
    this.server ??= await createOpencodeServer({
      port: 0,
      timeout: 10000,
      config: {
        model: this.options.model,
        permission: {
          question: "deny",
        },
      },
    });
    return this.server;
  }

  private async createClient({ directory }: { directory: string }): Promise<OpencodeClient> {
    const server = await this.getServer();
    return createOpencodeClient({ baseUrl: server.url, directory });
  }

  closeServer() {
    this.server?.close();
    this.server = undefined;
  }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const client = await this.createClient({ directory: params.cwd });
    const session = await client.session.create(
      { directory: params.cwd, title: "Acpella OpenCode ACP" },
      { throwOnError: true },
    );
    const sessionId = session.data.id;
    this.sessions.set(sessionId, session.data);
    return { sessionId };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const client = await this.createClient({ directory: params.cwd });
    const session = await client.session.get(
      { sessionID: params.sessionId, directory: params.cwd },
      { throwOnError: true },
    );
    this.sessions.set(params.sessionId, session.data);
    return {};
  }

  async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    const cwd = params.cwd ?? process.cwd();
    const client = await this.createClient({ directory: cwd });
    const sessions = await client.session.list(
      { directory: cwd, roots: true },
      { throwOnError: true },
    );
    return {
      sessions: sessions.data.map((session) => ({
        sessionId: session.id,
        cwd: session.directory,
        title: session.title,
        updatedAt: new Date(session.time.updated).toISOString(),
      })),
    };
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`unknown session: ${params.sessionId}`);
    }

    const client = await this.createClient({ directory: session.directory });

    let lifecycleStarted = false;
    let lifecycleCancelled = false;
    const lifecycle = Promise.withResolvers<void>();

    const messagePartTypes = new Map<string, Part["type"]>();
    const toolCallIds = new Set<string>();

    // define prompt loop event handler
    const handleEvent = async (event: GlobalEvent) => {
      const payload = event.payload;
      if (payload.type === "session.status" && payload.properties.sessionID === params.sessionId) {
        const props = payload.properties;
        if (props.status.type === "busy") {
          lifecycleStarted = true;
        }
        if (props.status.type === "idle" && lifecycleStarted) {
          lifecycle.resolve();
        }
        return;
      }

      if (payload.type === "session.error" && payload.properties.sessionID === params.sessionId) {
        console.error("[session.error]", payload.properties);
        const rawError = payload.properties.error;
        if (rawError) {
          // gracefully handle cancellation
          if (rawError.name === "MessageAbortedError") {
            lifecycleCancelled = true;
            lifecycle.resolve();
            return;
          }
          // surface model API availability error etc.
          const error = new Error(
            typeof rawError.data.message === "string"
              ? rawError.data.message
              : "unknown session error",
          );
          error.name = rawError.name;
          throw error;
        }
        return;
      }

      // auto approve permission requests
      if (
        payload.type === "permission.asked" &&
        payload.properties.sessionID === params.sessionId
      ) {
        console.error("[permission.asked]", payload.properties);
        const permission = payload.properties;
        await client.permission.reply({
          requestID: permission.id,
          reply: "once",
          directory: session.directory,
        });
        return;
      }

      // auto reject question requests
      if (payload.type === "question.asked" && payload.properties.sessionID === params.sessionId) {
        console.error("[question.asked]", payload.properties);
        const question = payload.properties;
        await client.question.reject({
          requestID: question.id,
          directory: session.directory,
        });
        return;
      }

      if (
        payload.type === "session.compacted" &&
        payload.properties.sessionID === params.sessionId
      ) {
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
        return;
      }

      if (
        payload.type === "message.part.updated" &&
        payload.properties.sessionID === params.sessionId
      ) {
        const part = payload.properties.part;
        if (part.type === "tool") {
          const sessionUpdate = (() => {
            if (!toolCallIds.has(part.callID)) {
              toolCallIds.add(part.callID);
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
        }
        if (part.type === "text" || part.type === "reasoning") {
          messagePartTypes.set(`${part.messageID}:${part.id}`, part.type);
        }
        return;
      }

      if (
        payload.type === "message.part.delta" &&
        payload.properties.sessionID === params.sessionId
      ) {
        const props = payload.properties;
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
    };

    // start event subscription
    const abortController = new AbortController();
    const eventResponse = await client.global.event({ signal: abortController.signal });
    const eventHandlerPromise = (async () => {
      try {
        for await (const event of eventResponse.stream) {
          await handleEvent(event);
        }
      } catch (error) {
        lifecycle.reject(error);
      }
    })();

    // start session prompt
    const promptParts: string[] = [];
    for (const prompt of params.prompt) {
      if (prompt.type === "text") {
        promptParts.push(prompt.text);
      } else {
        console.error(`unsupported prompt part type: ${prompt.type}`);
      }
    }
    const promptResponsePromise = client.session.prompt(
      {
        sessionID: params.sessionId,
        directory: session.directory,
        parts: promptParts.map((text) => ({ type: "text", text })),
      },
      { throwOnError: true },
    );

    let response: SessionPromptResponse | undefined;
    try {
      [{ data: response }] = await Promise.all([promptResponsePromise, lifecycle.promise]);
    } finally {
      abortController.abort();
      await eventHandlerPromise;
    }

    // send usage update
    if (!lifecycleCancelled && response && !response.info.error) {
      const info = response.info;
      const tokens = info.tokens;
      const used = tokens.input + (tokens.cache?.read ?? 0);
      const model = await getModel(client, {
        directory: session.directory,
        providerID: info.providerID,
        modelID: info.modelID,
      });
      const context = model?.limit.context;
      if (context !== undefined) {
        await this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "usage_update",
            used,
            size: context,
          },
        });
      }
    }

    return { stopReason: lifecycleCancelled ? "cancelled" : "end_turn" };
  }

  async cancel(params: CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      return;
    }

    const client = await this.createClient({ directory: session.directory });
    await client.session.abort(
      { sessionID: params.sessionId, directory: session.directory },
      { throwOnError: true },
    );
  }

  // TODO
  unstable_closeSession = async () => ({});
  authenticate = async () => ({});
}

async function getModel(
  client: OpencodeClient,
  options: {
    directory: string;
    providerID: string;
    modelID: string;
  },
) {
  const providers = await client.config.providers(
    { directory: options.directory },
    { throwOnError: true },
  );
  const provider = providers.data.providers.find((provider) => provider.id === options.providerID);
  return provider?.models[options.modelID];
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
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean" },
      model: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (parsed.values.help) {
    console.log(`\
Usage: acpella-opencode-acp [--model <provider/model>]

Options:
  --model <provider/model>  Model to use. Example: "openai/gpt-5.5". You can list by running "opencode models".
  --help                    Show this help
`);
    return;
  }

  const input = Writable.toWeb(process.stdout);
  const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(input, output);

  let agent: OpencodeAcpAgent;
  const connection = new AgentSideConnection((connection) => {
    agent = new OpencodeAcpAgent(connection, parsed.values);
    return agent;
  }, stream);

  // ensure child opencode server process is killed
  // when acp agent process is killed
  connection.signal.addEventListener("abort", () => {
    agent.closeServer();
  });
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.once(signal, () => {
      agent.closeServer();
      process.exit(0);
    });
  }
}

main();
