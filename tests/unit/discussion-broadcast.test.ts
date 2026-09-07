import { beforeEach, describe, expect, it } from "vitest";
import { AsyncQueue } from "@/lib/discussion/stream-queue";

describe("AsyncQueue", () => {
  it("delivers buffered values in order and resolves pending readers on close", async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    queue.push(2);
    expect(await queue.next()).toBe(1);
    expect(await queue.next()).toBe(2);
    const pending = queue.next();
    queue.close();
    await expect(pending).resolves.toBeUndefined();
  });

  it("aborts pending readers and ignores values after abort", async () => {
    const queue = new AsyncQueue<number>();
    const pending = queue.next();
    queue.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    queue.push(1);
    await expect(queue.next()).rejects.toThrow("cancelled");
  });
});
