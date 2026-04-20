#!/usr/bin/env node

// Minimal ACP-compatible echo agent for testing.
// Echoes back the prompt text as an agent_message_chunk.

import fs from "node:fs";
import path from "node:path";
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
import { z } from "zod";
import { readJsonFile } from "./utils-node.ts";

const testAgentStateSchema = z.object({
  nextSessionNumber: z.number().int().min(1),
  sessions: z.array(
    z.object({
      sessionId: z.string().min(1),
      cwd: z.string().min(1),
    }),
  ),
});

type TestAgentState = z.infer<typeof testAgentStateSchema>;

function getStateFile(cwd: string): string {
  return path.join(cwd, ".acpella/.test-agent.json");
}

function readState(cwd: string): TestAgentState {
  const stateFile = getStateFile(cwd);
  if (fs.existsSync(stateFile)) {
    try {
      return testAgentStateSchema.parse(readJsonFile(stateFile));
    } catch (e) {
      console.error(`[test-agent] Failed to read state file: ${stateFile}`, e);
    }
  }
  return {
    nextSessionNumber: 1,
    sessions: [],
  };
}

function writeState(cwd: string, state: TestAgentState): void {
  const stateFile = getStateFile(cwd);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

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

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const state = readState(params.cwd);
    const sessionId = `__testSession${state.nextSessionNumber}`;
    state.nextSessionNumber += 1;
    state.sessions.push({ sessionId, cwd: params.cwd });
    writeState(params.cwd, state);
    return { sessionId };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const state = readState(params.cwd);
    if (!state.sessions.some((session) => session.sessionId === params.sessionId)) {
      throw new Error(`unknown session: ${params.sessionId}`);
    }
    return {};
  }

  async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    const cwd = params.cwd ?? process.cwd();
    const state = readState(cwd);
    return {
      sessions: state.sessions.filter((session) => session.cwd === cwd),
    };
  }

  async unstable_closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
    const cwd = process.cwd();
    const state = readState(cwd);
    const sessions = state.sessions.filter((session) => session.sessionId !== params.sessionId);
    if (sessions.length === state.sessions.length) {
      throw new Error(`unknown session: ${params.sessionId}`);
    }
    writeState(cwd, { ...state, sessions });
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
    let text =
      params.prompt
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("") || "(empty)";

    if (!text.includes("__keep_metadata") && text.startsWith("<message_metadata>")) {
      text = text.replace(/^<message_metadata>[\s\S]*?<\/message_metadata>/, "").trim();
    }

    if (text.includes("__throw_error__")) {
      throw new Error("simulated error");
    }

    let reportText: string;
    if (text.startsWith("__env:")) {
      const key = text.slice(6);
      const value = process.env[key] ?? "(unset)";
      reportText = `env: ${key}=${value}`;
    } else if (text === "__session") {
      reportText = `session: ${params.sessionId}`;
    } else if (text.startsWith("__chunk_tool:")) {
      const title = text.slice(13);
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "before" },
        },
      });
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "__testToolCall",
          title,
        },
      });
      reportText = "after";
    } else if (text.startsWith("__tool:")) {
      const title = text.slice(7);
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "__testToolCall",
          title,
        },
      });
      reportText = `echo: ${text}`;
    } else if (text.startsWith("__usage_update:")) {
      const parts = text.slice(15).split(":");
      const used = Number(parts[0]);
      const size = Number(parts[1]);
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "usage_update",
          used,
          size,
        },
      });
      reportText = `echo: ${text}`;
    } else {
      reportText = `echo: ${text}`;
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

function main() {
  const input = Writable.toWeb(process.stdout);
  const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(input, output);
  new AgentSideConnection((conn) => new EchoAgent(conn), stream);
}

main();
