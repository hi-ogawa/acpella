import fs from "node:fs";
import path from "node:path";

export type QueuedLog = { t: number; data: object };

export interface JsonLoggerOptions {
  file: string;
  flushThrottleMs?: number;
  shouldFlushBeforeQueue?: (queuedLogs: readonly QueuedLog[], nextData: object) => boolean;
  processBatch?: (logs: QueuedLog[]) => object | object[];
}

export class JsonLogger {
  options: JsonLoggerOptions;
  queuedLogs: QueuedLog[] = [];
  flushTimeout: ReturnType<typeof setTimeout> | undefined;

  constructor(options: JsonLoggerOptions) {
    this.options = options;
    fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
  }

  log(data: object): void {
    const t = new Date().toISOString();
    this.flush();
    appendLog(this.options.file, { t, ...data });
  }

  queue(data: object): void {
    if (
      this.queuedLogs.length > 0 &&
      this.options.shouldFlushBeforeQueue?.(this.queuedLogs, data)
    ) {
      this.flush();
    }
    this.queuedLogs.push({ t: Date.now(), data });
    this.scheduleFlush();
  }

  flush() {
    this.cancelScheduledFlush();
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
    this.cancelScheduledFlush();
    this.flush();
  }

  private scheduleFlush() {
    if (typeof this.flushTimeout !== "undefined") {
      return;
    }
    const timeout = setTimeout(() => {
      this.flushTimeout = undefined;
      this.flush();
    }, this.options.flushThrottleMs ?? 1000);
    timeout.unref?.();
    this.flushTimeout = timeout;
  }

  private cancelScheduledFlush() {
    if (typeof this.flushTimeout !== "undefined") {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = undefined;
    }
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
