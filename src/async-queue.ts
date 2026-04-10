/** Push-based async iterable. Call push() to enqueue, finish() to close the iterator. */
export class AsyncQueue<T> {
  queue: T[] = [];
  notify: (() => void) | undefined;
  done = false;

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

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (!this.done || this.queue.length > 0) {
      while (this.queue.length > 0) yield this.queue.shift()!;
      if (!this.done)
        await new Promise<void>((r) => {
          this.notify = r;
        });
    }
  }
}
