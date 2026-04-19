export function truncateString(s: string, limit: number) {
  if (s.length > limit) {
    return s.slice(0, limit - 3) + "...";
  }
  return s;
}

export function addIndent({ text, indent }: { text: string; indent: string }): string {
  return text
    .split(/\r?\n/)
    .map((line) => `${indent}${line}`)
    .join("\n");
}

export function objectPickBy<K extends PropertyKey, V>(
  o: Record<K, V>,
  f: (v: V, k: K) => boolean,
): Record<K, V> {
  return Object.fromEntries(Object.entries(o).filter(([k, v]: any[]) => f(v, k))) as any;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class TimeoutManager {
  timer: ReturnType<typeof setTimeout> | undefined = undefined;

  set(callback: () => void, ms: number) {
    this.clear();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      callback();
    }, ms);
  }

  clear() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

export class PromiseSequencer {
  promise = Promise.resolve();

  run(callback: () => Promise<void>): void {
    this.promise = this.promise.then(callback, callback);
    this.promise.catch(() => {});
  }
}
