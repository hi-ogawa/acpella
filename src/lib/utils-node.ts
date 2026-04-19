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
