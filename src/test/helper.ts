import fs from "node:fs";
import path from "node:path";
import { onTestFinished } from "vitest";

export function useFs(options?: { prefix?: string; sourceDir?: string }) {
  const prefix = options?.prefix ?? "test";
  const root = path.join(import.meta.dirname, `../../.tmp/${prefix}-${crypto.randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  if (options?.sourceDir) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.cpSync(options.sourceDir, root, { recursive: true });
  }
  onTestFinished(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root };
}
