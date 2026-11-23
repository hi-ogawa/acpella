import fs from "node:fs";
import path from "node:path";
import type { SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk";
import { throttle, type Throttler } from "./timing.ts";

type LogEntry = { type: string } & Record<string, unknown>;
type TimedLogEntry = { t: number } & LogEntry;

interface JsonLoggerOptions {
  file: string;
  flushThrottleMs?: number;
}

export class JsonLogger {
  options: JsonLoggerOptions;
  queuedLogs: TimedLogEntry[] = [];
  handleQueue: Throttler;

  constructor(options: JsonLoggerOptions) {
    this.options = options;
    const throttleMs = this.options.flushThrottleMs ?? 1000;
    this.handleQueue = throttle(() => this.handleQueueImpl(), throttleMs);
    fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
  }

  log(data: LogEntry): void {
    const t = new Date().toISOString();
    this.handleQueue.flush();
    appendLog(this.options.file, { t, ...data });
  }

  queue(data: LogEntry): void {
    if (this.queuedLogs.length > 0 && this.queuedLogs.at(-1)!.type !== data.type) {
      this.handleQueue.flush();
    }
    this.queuedLogs.push({ t: Date.now(), ...data });
    this.handleQueue.schedule();
  }

  private handleQueueImpl() {
    if (this.queuedLogs.length > 0) {
      const queuedLogs = this.queuedLogs;
      this.queuedLogs = [];
      const data = processQueuedLogs(queuedLogs);
      appendLog(this.options.file, data);
    }
  }

  finish() {
    this.handleQueue.flush();
  }
}

function appendLog(file: string, data: object): void {
  try {
    fs.appendFileSync(file, `${JSON.stringify(data)}\n`);
  } catch (error) {
    console.error(`[logger] failed to write log '${file}':`, error);
  }
}

function processQueuedLogs(logs: TimedLogEntry[]): object {
  let { t, ...first } = logs[0];
  let output = {
    t: new Date(t).toISOString(),
    type: first.type,
  };
  if (logs.length === 1) {
    return { ...output, ...first };
  }
  return {
    ...output,
    batch: logs.map(({ type, ...log }) => ({ ...log, t: log.t - t })),
  };
}

export function formatSessionUpdateLogEntry(data: SessionUpdate): LogEntry {
  let output: LogEntry = {
    type: `update:${data.sessionUpdate}`,
    ...data,
  };
  delete output.sessionUpdate;
  if (
    data.sessionUpdate === "agent_message_chunk" ||
    data.sessionUpdate === "agent_thought_chunk"
  ) {
    output.type += `:${data.content.type}`;
    if (data.messageId) {
      output.type += `:${data.messageId}`;
      delete output.messageId;
    }
    if (data.content.type === "text") {
      output.text = data.content.text;
      output = { ...data.content, ...output };
      delete output.content;
    }
  }
  if (data.sessionUpdate === "tool_call_update") {
    if (data._meta) {
      output._meta = omitClaudeCodeToolResponse(data._meta);
    }
    // Replace image/audio base64 with a placeholder, see https://github.com/hi-ogawa/acpella/issues/348
    if (data.content) {
      output.content = data.content.map(replaceContentBase64);
    }
    if (Array.isArray(data.rawOutput)) {
      output.rawOutput = data.rawOutput.map(replaceRawOutputBase64);
    }
  }
  if (data.sessionUpdate === "available_commands_update") {
    // agents resend the full list with descriptions on every turn; names are enough for the log
    output.availableCommands = data.availableCommands.map((command) => command.name);
  }
  return output;
}

function formatBase64Placeholder(data: string): string {
  return `<base64 ${data.length} chars>`;
}

// ACP image/audio block `{ type: "image", data, mimeType }`
function replaceContentBase64(item: ToolCallContent): ToolCallContent {
  if (item.type === "content" && (item.content.type === "image" || item.content.type === "audio")) {
    return {
      ...item,
      content: { ...item.content, data: formatBase64Placeholder(item.content.data) },
    };
  }
  return item;
}

// Claude's raw tool result `{ type: "image", source: { type: "base64", data, media_type } }`
function replaceRawOutputBase64(item: unknown): unknown {
  if (
    isRecord(item) &&
    isRecord(item.source) &&
    item.source.type === "base64" &&
    typeof item.source.data === "string"
  ) {
    return {
      ...item,
      source: { ...item.source, data: formatBase64Placeholder(item.source.data) },
    };
  }
  return item;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Claude Code's `_meta.claudeCode.toolResponse` mostly repeats `content`/`rawOutput`
// and dominates the log size, so it is dropped while the rest of `claudeCode` is kept.
// https://github.com/hi-ogawa/acpella/issues/348
function omitClaudeCodeToolResponse(meta: Record<string, unknown>): Record<string, unknown> {
  const claudeCode = meta.claudeCode;
  if (typeof claudeCode !== "object" || !claudeCode || !("toolResponse" in claudeCode)) {
    return meta;
  }
  const { toolResponse: _, ...rest } = claudeCode;
  return { ...meta, claudeCode: rest };
}
