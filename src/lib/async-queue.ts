// TODO: rename to AsyncIterableQueue. move to utils.ts
/** Push-based async iterable. Call push() to enqueue, finish() to close, error() to close with an error. */
export class AsyncQueue<T> {
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
