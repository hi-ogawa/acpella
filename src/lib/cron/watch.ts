import { FileWatcher } from "../../utils/fs.ts";
import { formatError } from "../../utils/index.ts";
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
      onChange: () => {
        this.reload();
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
