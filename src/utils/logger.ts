import fs from "node:fs";
import path from "node:path";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
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
  if (isTextChunkType(first.type) && hasSharedMessageId(logs)) {
    return {
      ...output,
      messageId: first.messageId,
      batch: logs.map(({ type, messageId, ...log }) => ({ ...log, t: log.t - t })),
    };
  }
  return {
    ...output,
    batch: logs.map(({ type, ...log }) => ({ ...log, t: log.t - t })),
  };
}

function isTextChunkType(type: string) {
  return type === "update:agent_message_chunk:text" || type === "update:agent_thought_chunk:text";
}

function hasSharedMessageId(logs: TimedLogEntry[]) {
  const messageId = logs[0].messageId;
  return typeof messageId === "string" && logs.every((log) => log.messageId === messageId);
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
  return output;
}
