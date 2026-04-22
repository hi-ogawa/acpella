import fs from "node:fs";
import path from "node:path";
import { throttle, type Throttler } from "./utils.ts";

type LogEntry = { type: string } & Record<string, unknown>;
type TimedLogEntry = { t: number } & LogEntry;

export interface JsonLoggerOptions {
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
  const first = logs[0];
  return {
    t: new Date(first.t).toISOString(),
    type: first.type,
    batch: logs.map(({ type, ...log }) => ({ ...log, t: log.t - first.t })),
  };
}
