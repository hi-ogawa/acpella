import fs from "node:fs";
import path from "node:path";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { formatError } from "./utils.ts";

export interface AcpPromptLogger {
  prompt: (text: string) => void;
  sessionUpdate: (update: SessionUpdate) => void;
  done: (options: { cancelled: boolean }) => void;
  error: (error: unknown) => void;
}

export function createAcpPromptLogger(options: {
  logsDir: string;
  sessionName: string;
  agentKey: string;
  agentSessionId: string;
  console?: Pick<Console, "log" | "error">;
}): AcpPromptLogger {
  const sessionLogFile = path.join(
    options.logsDir,
    "acp",
    options.agentKey,
    `${options.agentSessionId}.jsonl`,
  );
  const consoleWriter = options.console ?? console;
  const baseTrace = {
    sessionName: options.sessionName,
    agentKey: options.agentKey,
    agentSessionId: options.agentSessionId,
  };
  const updateLogLabel = `[${options.sessionName}] [acp:update]`;

  return {
    prompt(text) {
      appendJsonlTrace(sessionLogFile, {
        type: "prompt",
        ...baseTrace,
        value: {
          sessionId: options.agentSessionId,
          prompt: [{ type: "text", text }],
        },
      });
    },
    sessionUpdate(update) {
      appendJsonlTrace(sessionLogFile, {
        type: "session_update",
        ...baseTrace,
        value: update,
      });

      switch (update.sessionUpdate) {
        case "tool_call": {
          consoleWriter.log(`${updateLogLabel} tool_call: ${update.title}`);
          break;
        }
        case "usage_update": {
          consoleWriter.log(
            `${updateLogLabel} usage_update: (used: ${update.used}, size: ${update.size})`,
          );
          break;
        }
        default: {
          consoleWriter.log(`${updateLogLabel} ${update.sessionUpdate}`);
          break;
        }
      }
    },
    done({ cancelled }) {
      appendJsonlTrace(sessionLogFile, {
        type: "done",
        ...baseTrace,
        value: { cancelled },
      });
    },
    error(error) {
      appendJsonlTrace(sessionLogFile, {
        type: "error",
        ...baseTrace,
        value: { error: formatError(error) },
      });
    },
  };
}

function appendJsonlTrace(file: string, value: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...value })}\n`);
  } catch (error) {
    console.error("[acp:trace] failed to append prompt trace:", error);
  }
}
