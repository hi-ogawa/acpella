import fs from "node:fs";
import path from "node:path";
import { onTestFinished, vi } from "vitest";

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

export function advanceTimersTo(time: string) {
  const target = Date.parse(time);
  if (Number.isNaN(target)) {
    throw new Error(`Invalid timer target: ${time}`);
  }

  const delta = target - Date.now();
  if (delta < 0) {
    throw new Error(`Cannot advance timers backwards to ${new Date(target).toISOString()}`);
  }

  vi.advanceTimersByTime(delta);
}
