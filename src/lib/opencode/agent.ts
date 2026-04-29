#!/usr/bin/env node

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
  type OpencodeClient,
} from "@opencode-ai/sdk/v2";

process.env.PATH = `/home/hiroshi/.opencode/bin:${process.env.PATH ?? ""}`;

async function withOpenCode<T>(cwd: string, callback: (client: OpencodeClient) => Promise<T>) {
  const server = await createOpencodeServer({ port: 0, timeout: 10000 });
  try {
    return await callback(createOpencodeClient({ baseUrl: server.url, directory: cwd }));
  } finally {
    server.close();
  }
}

class OpenCodeExperimentAgent implements Agent {
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
        .create({ directory: params.cwd, title: "OpenCode ACP experiment" }, { throwOnError: true })
        .then((response) => response.data!);
      this.sessions.set(session.id, { cwd: params.cwd });
      return { sessionId: session.id };
    });
  }

  async loadSession(_params: LoadSessionRequest): Promise<LoadSessionResponse> {
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
          const part = eventPartForSession(event, params.sessionId);
          if (!part?.id) {
            continue;
          }
          const text = partText(part);
          if (!text) {
            continue;
          }
          const previous = emitted.get(part.id) ?? "";
          if (text === previous) {
            continue;
          }
          const delta = text.startsWith(previous) ? text.slice(previous.length) : text;
          emitted.set(part.id, text);
          if (!delta) {
            continue;
          }
          await this.connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: delta },
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
      return response.parts.map(partText).filter(Boolean).join("") || "(empty)";
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

function partText(part: unknown): string {
  if (!part || typeof part !== "object") {
    return "";
  }
  const record = part as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  return "";
}

function eventPartForSession(
  event: unknown,
  sessionId: string,
): { id?: string; text?: string; content?: string } | undefined {
  if (!event || typeof event !== "object") {
    return;
  }
  const payload = (event as Record<string, unknown>).payload;
  if (!payload || typeof payload !== "object") {
    return;
  }
  const properties = (payload as Record<string, unknown>).properties;
  if (!properties || typeof properties !== "object") {
    return;
  }
  const record = properties as Record<string, unknown>;
  if (record.sessionID !== sessionId) {
    return;
  }
  const part = record.part;
  if (!part || typeof part !== "object") {
    return;
  }
  return part as { id?: string; text?: string; content?: string };
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
new AgentSideConnection(
  (connection) => new OpenCodeExperimentAgent(connection),
  ndJsonStream(input, output),
);
