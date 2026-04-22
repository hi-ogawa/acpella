import fs from "node:fs";
import path from "node:path";
import { throttle, type Throttler } from "./utils";

export type QueuedLog = { t: number; data: object };

export interface JsonLoggerOptions {
  file: string;
  flushThrottleMs?: number;
  getBatchKey?: (data: object | undefined) => string;
  processBatch?: (logs: QueuedLog[]) => object | object[];
}

export class JsonLogger {
  options: JsonLoggerOptions;
  queuedLogs: QueuedLog[] = [];
  handleQueue: Throttler;

  constructor(options: JsonLoggerOptions) {
    this.options = options;
    const throttleMs = this.options.flushThrottleMs ?? 1000;
    this.handleQueue = throttle(() => this.handleQueueImpl(), throttleMs);
    fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
  }

  log(data: object): void {
    const t = new Date().toISOString();
    this.handleQueue.flush();
    appendLog(this.options.file, { t, ...data });
  }

  queue(data: object): void {
    const getBatchKey = this.options.getBatchKey;
    const lastLog = this.queuedLogs[this.queuedLogs.length - 1];
    if (
      getBatchKey &&
      this.queuedLogs.length > 0 &&
      getBatchKey(lastLog?.data) !== getBatchKey(data)
    ) {
      this.handleQueue.flush();
    }
    this.queuedLogs.push({ t: Date.now(), data });
    this.handleQueue.schedule();
  }

  private handleQueueImpl() {
    if (this.queuedLogs.length > 0) {
      const queuedLogs = this.queuedLogs;
      this.queuedLogs = [];
      const data = (this.options.processBatch ?? formatQueuedLogsBatch)(queuedLogs);
      for (const entry of Array.isArray(data) ? data : [data]) {
        appendLog(this.options.file, entry);
      }
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

export function formatQueuedLogsBatch(logs: QueuedLog[]): object {
  const t = logs[0].t;
  for (const log of logs) {
    log.t -= t;
  }
  return { t: new Date(t).toISOString(), batch: logs };
}
