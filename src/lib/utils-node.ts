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

// TODO
type StateFileManagerOptions<T> = {
  file: string;
  parse: (data: unknown) => T;
  defaultValue: () => T;
};

export class StateFileManager<T> {
  options: StateFileManagerOptions<T>;
  data: T;

  constructor(options: StateFileManagerOptions<T>) {
    this.options = options;
    this.data = this.readState();
  }

  private readState() {
    const { file, defaultValue } = this.options;
    try {
      return this.options.parse(readJsonFile(file, defaultValue));
    } catch (e) {
      console.error(`[StateFileManager] failed to read ${file}:`, e);
      return defaultValue();
    }
  }

  reload() {
    const { file, defaultValue } = this.options;
    const newData = readJsonFile(file, defaultValue);
    this.options.parse(newData);
    this.data = newData;
  }

  set(updater: (data: T) => void): void {
    const clone = structuredClone(this.data);
    updater(clone);
    this.options.parse(clone);
    this.data = clone;
    writeJsonFile(this.options.file, this.data);
  }
}
