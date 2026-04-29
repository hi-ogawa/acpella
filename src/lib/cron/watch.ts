import { FileWatcher } from "../../utils/fs.ts";
import { debounce, type Debouncer, formatError } from "../../utils/index.ts";
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
  watcher: FileWatcher;

  constructor(options: CronFileWatcher["options"]) {
    this.options = options;
    this.reloadDebouncer = debounce(() => this.reload(), RELOAD_DEBOUNCE_MS);
    this.watcher = new FileWatcher({
      file: this.options.store.options.cronFile,
      intervalMs: WATCH_INTERVAL_MS,
      onChange: () => {
        this.reloadDebouncer.schedule();
      },
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
