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

  constructor(options: CronFileWatcher["options"]) {
    this.options = options;
    this.reloadDebouncer = debounce(() => this.reload(), RELOAD_DEBOUNCE_MS);
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    fs.watchFile(
      this.options.store.options.cronFile,
      {
        interval: WATCH_INTERVAL_MS,
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
