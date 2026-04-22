import fs from "node:fs";
import path from "node:path";

type QueuedLog = { t: number; data: object };

export class JsonLogger {
  options: {
    file: string;
    flushThrottleMs?: number;
  };
  queuedLogs: QueuedLog[] = [];
  flushThrottled: () => void;

  constructor(options: JsonLogger["options"]) {
    this.options = options;
    fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
    const throttleMs = this.options.flushThrottleMs ?? 1000;
    this.flushThrottled = throttle(() => this.flush(), throttleMs);
  }

  log(data: object): void {
    const t = new Date().toISOString();
    this.flush();
    appendLog(this.options.file, { t, ...data });
  }

  queue(data: object): void {
    this.queuedLogs.push({ t: Date.now(), data });
    this.flushThrottled();
  }

  flush() {
    if (this.queuedLogs.length > 0) {
      const queuedLogs = this.queuedLogs;
      this.queuedLogs = [];
      const data = processQueuedLogs(queuedLogs);
      appendLog(this.options.file, data);
    }
  }

  finish() {
    this.flush();
  }
}

function appendLog(file: string, data: object): void {
  try {
    fs.appendFileSync(file, `${JSON.stringify(data)}\n`);
  } catch (error) {
    console.error(`[logger] failed to write log '${file}':`, error);
  }
}

function processQueuedLogs(logs: QueuedLog[]): object {
  const t = logs[0].t;
  for (const log of logs) {
    log.t -= t;
  }
  return { t: new Date(t).toISOString(), batch: logs };
}

function throttle(func: () => void, delay: number): () => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (typeof timeout === "undefined") {
      timeout = setTimeout(() => {
        func();
        timeout = undefined;
      }, delay);
    }
  };
}
