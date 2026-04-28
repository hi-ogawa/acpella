import fs from "node:fs";
import path from "node:path";
import { debounce, type Debouncer } from "./utils.ts";

export function writeJsonFile(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

export function readJsonFile<T>(file: string, defaultValue?: () => T): T {
  if (!defaultValue || fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  }
  return defaultValue();
}

export class FileWatcher {
  options: {
    file: string;
    intervalMs: number;
    debounceMs: number;
    onChange: () => void;
  };
  started = false;
  previousStats?: fs.Stats;
  interval?: ReturnType<typeof setInterval>;
  onChangeDebouncer: Debouncer;

  constructor(options: FileWatcher["options"]) {
    this.options = options;
    this.onChangeDebouncer = debounce(options.onChange, options.debounceMs);
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.previousStats = readStats(this.options.file);
    this.interval = setInterval(() => {
      this.poll();
    }, this.options.intervalMs);
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

export class FileStateManager<T> {
  options: {
    file: string;
    parse: (data: unknown) => T;
    defaultValue: () => T;
  };
  state: T;

  constructor(options: FileStateManager<T>["options"]) {
    this.options = options;
    this.state = this.read();
  }

  read(options?: { strict: boolean }): T {
    const { file, defaultValue } = this.options;
    try {
      return this.options.parse(readJsonFile(file, defaultValue));
    } catch (e) {
      if (options?.strict) {
        throw e;
      }
      console.error(`[FileStateManager] failed to read ${file}:`, e);
      return defaultValue();
    }
  }

  reload() {
    const { file, defaultValue } = this.options;
    const newData = readJsonFile(file, defaultValue);
    this.state = this.options.parse(newData);
  }

  set(updater: (data: T) => void): void {
    // mutate a clone so invalid data won't become in-memory state
    // nor be written to a file.
    const clone = structuredClone(this.state);
    updater(clone);
    this.state = this.options.parse(clone);
    writeJsonFile(this.options.file, this.state);
  }
}
