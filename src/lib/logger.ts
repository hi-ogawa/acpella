import fs from "node:fs";
import path from "node:path";

export type QueuedLog = { t: number; data: object };

export interface JsonLoggerOptions {
  file: string;
  flushThrottleMs?: number;
  // TODO: deslop
  shouldFlushBeforeQueue?: (queuedLogs: readonly QueuedLog[], nextData: object) => boolean;
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
    if (
      this.queuedLogs.length > 0 &&
      this.options.shouldFlushBeforeQueue?.(this.queuedLogs, data)
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

type Throttler = ReturnType<typeof throttle>;

function throttle(fn: () => void, ms: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  function schedule() {
    if (typeof timeout === "undefined") {
      timeout = setTimeout(() => {
        timeout = undefined;
        fn();
      }, ms);
    }
  }

  function cancel() {
    if (typeof timeout !== "undefined") {
      clearTimeout(timeout);
      timeout = undefined;
    }
  }

  function flush() {
    cancel();
    fn();
  }

  return { schedule, cancel, flush };
}
