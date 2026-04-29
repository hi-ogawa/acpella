import fs from "node:fs";
import { debounce, formatError, type Debouncer } from "../lib/utils.ts";
import type { CronRunner } from "./runner.ts";
import type { CronStore } from "./store.ts";

export class CronFileWatcher {
  options: {
    store: CronStore;
    runner: CronRunner;
  };
  started = false;
  watcher: FileWatcher;

  constructor(options: CronFileWatcher["options"]) {
    this.options = options;
    this.watcher = new FileWatcher({
      file: this.options.store.options.cronFile,
      onChange: () => this.reload(),
    });
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.watcher.start();
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    this.watcher.stop();
  }

  reload(): void {
    try {
      this.options.store.reload();
      this.options.runner.refresh();
      console.log("[cron] Reloaded cron jobs from external cron file change");
    } catch (error) {
      console.error(
        `[cron] Failed to reload cron jobs after external cron file change: ${formatError(error)}`,
      );
    }
  }
}

const WATCH_RELOAD_DEBOUNCE_MS = 250;
const WATCH_INTERVAL_MS = 1000;

export class FileWatcher {
  options: {
    file: string;
    onChange: () => void;
  };
  started = false;
  previousStats?: fs.Stats;
  interval?: ReturnType<typeof setInterval>;
  onChangeDebouncer: Debouncer;

  constructor(options: FileWatcher["options"]) {
    this.options = options;
    this.onChangeDebouncer = debounce(options.onChange, WATCH_RELOAD_DEBOUNCE_MS);
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.previousStats = readStats(this.options.file);
    this.interval = setInterval(() => {
      this.poll();
    }, WATCH_INTERVAL_MS);
    this.interval.unref?.();
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    this.onChangeDebouncer.cancel();
    this.previousStats = undefined;
  }

  poll(): void {
    const currentStats = readStats(this.options.file);
    if (didStatsChange(currentStats, this.previousStats)) {
      this.onChangeDebouncer.schedule();
    }
    this.previousStats = currentStats;
  }
}

function readStats(file: string): fs.Stats | undefined {
  try {
    return fs.statSync(file);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

function didStatsChange(current: fs.Stats | undefined, previous: fs.Stats | undefined): boolean {
  if (!current || !previous) {
    return current !== previous;
  }
  return (
    current.mtimeMs !== previous.mtimeMs ||
    current.ctimeMs !== previous.ctimeMs ||
    current.size !== previous.size
  );
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
