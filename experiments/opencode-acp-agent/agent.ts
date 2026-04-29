#!/usr/bin/env node

import { Readable, Writable } from "node:stream"
import { createOpencodeClient, createOpencodeServer, type OpencodeClient } from "@opencode-ai/sdk/v2"
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
} from "@agentclientprotocol/sdk"

process.env.PATH = `/home/hiroshi/.opencode/bin:${process.env.PATH ?? ""}`

async function withOpenCode<T>(cwd: string, callback: (client: OpencodeClient) => Promise<T>) {
  const server = await createOpencodeServer({ port: 0, timeout: 10000 })
  try {
    return await callback(createOpencodeClient({ baseUrl: server.url, directory: cwd }))
  } finally {
    server.close()
  }
}

class OpenCodeExperimentAgent implements Agent {
  private connection: AgentSideConnection

  constructor(connection: AgentSideConnection) {
    this.connection = connection
  }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
    }
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    return await withOpenCode(params.cwd, async (client) => {
      const session = await client.session
        .create({ directory: params.cwd, title: "OpenCode ACP experiment" }, { throwOnError: true })
        .then((response) => response.data!)
      return { sessionId: session.id }
    })
  }

  async loadSession(_params: LoadSessionRequest): Promise<LoadSessionResponse> {
    return {}
  }

  async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    const cwd = params.cwd ?? process.cwd()
    return await withOpenCode(cwd, async (client) => {
      const sessions = await client.session
        .list({ directory: cwd, roots: true }, { throwOnError: true })
        .then((response) => response.data ?? [])
      return {
        sessions: sessions.map((session) => ({
          sessionId: session.id,
          cwd: session.directory,
          title: session.title,
          updatedAt: new Date(session.time.updated).toISOString(),
        })),
      }
    })
  }

  async unstable_closeSession(_params: CloseSessionRequest): Promise<CloseSessionResponse> {
    return {}
  }

  async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
    return {}
  }

  async setSessionMode(_params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    return {}
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const text = params.prompt
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")

    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `opencode-experiment echo: ${text || "(empty)"}` },
      },
    })

    return { stopReason: "end_turn" }
  }

  async cancel(_params: CancelNotification): Promise<void> {}
}

const input = Writable.toWeb(process.stdout)
const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
new AgentSideConnection((connection) => new OpenCodeExperimentAgent(connection), ndJsonStream(input, output))
