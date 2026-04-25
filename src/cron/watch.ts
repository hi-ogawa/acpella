import fs from "node:fs";
import { debounce, type Debouncer, formatError } from "../lib/utils.ts";
import type { CronRunner } from "./runner.ts";
import type { CronStore } from "./store.ts";

const RELOAD_DEBOUNCE_MS = 250;
const WATCH_INTERVAL_MS = 1000;

export class CronFileWatcher {
  options: {
    store: CronStore;
    runner: CronRunner;
  };
  started = false;
  reloadDebouncer: Debouncer;
  watcher?: FileWatcher;

  constructor(options: CronFileWatcher["options"]) {
    this.options = options;
    this.reloadDebouncer = debounce(() => this.reload(), RELOAD_DEBOUNCE_MS);
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.watcher = watchFile({
      file: this.options.store.options.cronFile,
      intervalMs: WATCH_INTERVAL_MS,
      onChange: () => {
        this.reloadDebouncer.schedule();
      },
    });
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    this.watcher?.dispose();
    this.watcher = undefined;
    this.reloadDebouncer.cancel();
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

interface FileWatcher {
  dispose: () => void;
}

function watchFile(options: {
  file: string;
  intervalMs: number;
  onChange: () => void;
}): FileWatcher {
  let previousStats = readStats(options.file);
  const interval = setInterval(() => {
    const currentStats = readStats(options.file);
    if (didStatsChange(currentStats, previousStats)) {
      options.onChange();
    }
    previousStats = currentStats;
  }, options.intervalMs);

  return {
    dispose: () => {
      clearInterval(interval);
    },
  };
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
