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

  finish(): void {
    this.done = true;
    this.notify?.();
    this.notify = undefined;
  }

  error(err: unknown): void {
    this.err = err;
    this.done = true;
    this.notify?.();
    this.notify = undefined;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (!this.done || this.queue.length > 0) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (!this.done) {
        await new Promise<void>((r) => {
          this.notify = r;
        });
      }
    }
    if (this.err !== undefined) {
      throw this.err;
    }
  }
}
