/** Small async FIFO used to bridge synchronous in-process broadcasts to SSE. */
export class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{
    resolve: (value: T | undefined) => void;
    reject: (error: Error) => void;
  }> = [];
  private closed = false;
  private failure: Error | null = null;

  push(value: T): boolean {
    if (this.closed) return false;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(value);
    else this.values.push(value);
    return true;
  }

  next(): Promise<T | undefined> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve(value);
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.resolve(undefined);
    return new Promise<T | undefined>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length) this.waiters.shift()!.resolve(undefined);
  }

  abort(error = new Error("queue aborted")): void {
    if (this.closed && this.failure) return;
    this.closed = true;
    this.failure = error;
    this.values.length = 0;
    while (this.waiters.length) this.waiters.shift()!.reject(error);
  }
}
