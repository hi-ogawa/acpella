import fs from "node:fs";
import path from "node:path";

export class JsonLogger<T = object> {
  options: {
    file: string;
  };

  constructor(options: { file: string }) {
    this.options = options;
    fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
  }

  log(data: T): void {
    try {
      const entry = { timestamp: new Date().toISOString(), ...data };
      fs.appendFileSync(this.options.file, `${JSON.stringify(entry)}\n`);
    } catch (error) {
      console.error(`[logger] failed to write log '${this.options.file}':`, error);
    }
  }
}
