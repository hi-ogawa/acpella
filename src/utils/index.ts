export function truncateString(s: string, limit: number) {
  if (s.length > limit) {
    return s.slice(0, limit - 3) + "...";
  }
  return s;
}

export * from "./timing.ts";

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

export const uniq = <T>(values: T[]): T[] => [...new Set(values)];

export function formatTime(time: number | Temporal.Instant, timezone?: string): string {
  let instant: Temporal.Instant;
  if (typeof time === "number") {
    instant = Temporal.Instant.fromEpochMilliseconds(time);
  } else {
    instant = time;
  }
  if (timezone) {
    return instant.toZonedDateTimeISO(timezone).toString({
      calendarName: "never",
      fractionalSecondDigits: 0,
      smallestUnit: "second",
      timeZoneName: "never",
    });
  }
  return instant.toString({
    fractionalSecondDigits: 0,
    smallestUnit: "second",
  });
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; value: E };
export const Result = {
  ok: <T>(value: T): Result<T, never> => ({ ok: true, value }),
  err: <E>(value: E): Result<never, E> => ({ ok: false, value }),
};

export class AsyncIterableQueue<T> {
  private queue: T[] = [];
  private notify: (() => void) | undefined;
  private done = false;
  private err: unknown;

  push(value: T): void {
    this.queue.push(value);
    this.notify?.();
    this.notify = undefined;
  }

  finish(err?: unknown): void {
    this.done = true;
    this.err = err;
    this.notify?.();
    this.notify = undefined;
  }

  async *consume(): AsyncGenerator<T> {
    do {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (!this.done) {
        await new Promise<void>((r) => {
          this.notify = r;
        });
      }
    } while (!this.done);
    if (this.err !== undefined) {
      throw this.err;
    }
  }
}

// serialize async function execution
export class AsyncLane {
  promise: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.promise.then(fn);
    this.promise = result.then(
      () => {},
      () => {},
    );
    return result;
  }
}

export class DefaultMap<K, V> extends Map<K, V> {
  options: {
    init: (k: K) => V;
  };
  constructor(options: DefaultMap<K, V>["options"]) {
    super();
    this.options = options;
  }

  override get(key: K): V {
    if (!this.has(key)) {
      this.set(key, this.options.init(key));
    }
    return super.get(key)!;
  }
}
