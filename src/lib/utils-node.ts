import fs from "node:fs";
import path from "node:path";

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

type FileStateManagerOptions<T> = {
  file: string;
  parse: (data: unknown) => T;
  defaultValue: () => T;
};

export class FileStateManager<T> {
  options: FileStateManagerOptions<T>;
  state: T;

  constructor(options: FileStateManagerOptions<T>) {
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
