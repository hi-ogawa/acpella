#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { Readable, Writable } from "node:stream"
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk/v2"
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

type ExperimentState = {
  nextSessionNumber: number
  sessions: Array<{ sessionId: string; cwd: string }>
}

function getStateFile(cwd: string) {
  return path.join(cwd, ".acpella/.opencode-acp-agent.json")
}

function readState(cwd: string): ExperimentState {
  const stateFile = getStateFile(cwd)
  if (!fs.existsSync(stateFile)) return { nextSessionNumber: 1, sessions: [] }
  return JSON.parse(fs.readFileSync(stateFile, "utf8")) as ExperimentState
}

function writeState(cwd: string, state: ExperimentState) {
  const stateFile = getStateFile(cwd)
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
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
    const state = readState(params.cwd)
    const sessionId = `opencode-experiment-${state.nextSessionNumber}`
    state.nextSessionNumber += 1
    state.sessions.push({ sessionId, cwd: params.cwd })
    writeState(params.cwd, state)
    return { sessionId }
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const state = readState(params.cwd)
    if (!state.sessions.some((session) => session.sessionId === params.sessionId)) {
      throw new Error(`unknown session: ${params.sessionId}`)
    }
    return {}
  }

  async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    const cwd = params.cwd ?? process.cwd()
    const server = await createOpencodeServer({ port: 0, timeout: 10000 })
    try {
      const client = createOpencodeClient({ baseUrl: server.url, directory: cwd })
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
    } finally {
      server.close()
    }
  }

  async unstable_closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
    const cwd = process.cwd()
    const state = readState(cwd)
    writeState(cwd, {
      ...state,
      sessions: state.sessions.filter((session) => session.sessionId !== params.sessionId),
    })
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
