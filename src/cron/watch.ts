import fs from "node:fs";
import { debounce, type Debouncer, formatError } from "../lib/utils.ts";
import type { CronRunner } from "./runner.ts";
import type { CronStore } from "./store.ts";

export interface CronFileWatcherOptions {
  store: CronStore;
  runner: CronRunner;
  debounceMs?: number;
  watchIntervalMs?: number;
}

export class CronFileWatcher {
  options: Required<CronFileWatcherOptions>;
  started = false;
  reloadDebouncer: Debouncer;

  constructor(options: CronFileWatcherOptions) {
    this.options = {
      debounceMs: 250,
      watchIntervalMs: 1000,
      ...options,
    };
    this.reloadDebouncer = debounce(() => this.reload(), this.options.debounceMs);
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    fs.watchFile(
      this.options.store.options.cronFile,
      {
        interval: this.options.watchIntervalMs,
      },
      this.handleWatchEvent,
    );
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    fs.unwatchFile(this.options.store.options.cronFile, this.handleWatchEvent);
    this.reloadDebouncer.cancel();
  }

  handleWatchEvent = (current: fs.Stats, previous: fs.Stats): void => {
    if (
      current.mtimeMs === previous.mtimeMs &&
      current.ctimeMs === previous.ctimeMs &&
      current.size === previous.size
    ) {
      return;
    }
    this.reloadDebouncer.schedule();
  };

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
