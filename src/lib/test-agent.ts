#!/usr/bin/env node

// Minimal ACP-compatible echo agent for testing.
// Echoes back the prompt text as an agent_message_chunk.

import { Readable, Writable } from "node:stream";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type CloseSessionRequest,
  type CloseSessionResponse,
  type AuthenticateRequest,
  type AuthenticateResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type PromptRequest,
  type PromptResponse,
  type CancelNotification,
} from "@agentclientprotocol/sdk";

class EchoAgent implements Agent {
  private connection: AgentSideConnection;

  constructor(connection: AgentSideConnection) {
    this.connection = connection;
  }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
    };
  }

  async newSession(_params: NewSessionRequest): Promise<NewSessionResponse> {
    return { sessionId: "__testLoadSession" };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    if (params.sessionId !== "__testLoadSession") {
      throw new Error(`unknown session: ${params.sessionId}`);
    }
    return {};
  }

  async listSessions(_params: ListSessionsRequest): Promise<ListSessionsResponse> {
    return {
      sessions: [{ sessionId: "__testLoadSession", cwd: "/" }],
    };
  }

  async unstable_closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
    if (params.sessionId !== "__testLoadSession") {
      throw new Error(`unknown session: ${params.sessionId}`);
    }
    return {};
  }

  async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
    return {};
  }

  async setSessionMode(_params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    return {};
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    // Echo the prompt text back
    const text =
      params.prompt
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("") || "(empty)";
    const userText = extractUserTextFromMetadataPrompt(text);

    let reportText: string;
    if (userText.startsWith("__env:")) {
      const key = userText.slice(6);
      const value = process.env[key] ?? "(unset)";
      reportText = `env: ${key}=${value}`;
    } else {
      reportText = `echo: ${userText}`;
    }

    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: reportText },
      },
    });

    return { stopReason: "end_turn" };
  }

  async cancel(_params: CancelNotification): Promise<void> {}
}

function extractUserTextFromMetadataPrompt(text: string): string {
  const metadataCloseTag = "</message_metadata>";
  const metadataCloseIndex = text.lastIndexOf(metadataCloseTag);
  if (metadataCloseIndex === -1) {
    return text;
  }
  return text.slice(metadataCloseIndex + metadataCloseTag.length).trimStart();
}

function main() {
  const input = Writable.toWeb(process.stdout);
  const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(input, output);
  new AgentSideConnection((conn) => new EchoAgent(conn), stream);
}

main();
