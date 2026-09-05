import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRunOneOnOneTurn = vi.fn();
vi.mock("@/lib/discussion/dsh-service", () => ({
  runOneOnOneTurn: (...a: unknown[]) => mockRunOneOnOneTurn(...a),
}));

import { streamOneOnOneDsh } from "@/lib/discussion/oneonone-dsh";
import { DshProtocolError } from "@/lib/dsh/errors";

async function collectFrames(body: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  return raw
    .split("\n\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^data: /, ""));
}

describe("oneonone-dsh SSE (P0)", () => {
  beforeEach(() => {
    mockRunOneOnOneTurn.mockReset();
  });

  it("emits only an error frame when the DSH turn fails at runtime", async () => {
    mockRunOneOnOneTurn.mockResolvedValue({
      participantId: "p1",
      sessionId: "s1",
      finalText: "",
      eventsWritten: 0,
      status: "failed",
      error: "wire lost",
    });
    const res = streamOneOnOneDsh("d1", "p1", "问题？", { id: "init-1", shortId: "ABC" });
    const frames = await collectFrames(res.body!);
    const parsed = frames.map((f) => JSON.parse(f) as { type: string });
    expect(parsed.map((p) => p.type)).toEqual(["init", "error"]);
    expect(frames.some((f) => f.includes("delta"))).toBe(false);
    expect(frames.some((f) => f.includes("done"))).toBe(false);
  });

  it("emits delta then done when the turn succeeds", async () => {
    mockRunOneOnOneTurn.mockResolvedValue({
      participantId: "p1",
      sessionId: "s1",
      finalText: "好的，我认为……",
      eventsWritten: 0,
      status: "completed",
    });
    const res = streamOneOnOneDsh("d1", "p1", "问题？", { id: "init-1", shortId: "ABC" });
    const frames = await collectFrames(res.body!);
    const parsed = frames.map((f) => JSON.parse(f) as { type: string; text?: string });
    expect(parsed.map((p) => p.type)).toEqual(["init", "delta", "done"]);
    expect(parsed[1].text).toBe("好的，我认为……");
  });

  it("never emits done after an error even when runOneOnOneTurn throws", async () => {
    mockRunOneOnOneTurn.mockRejectedValue(new DshProtocolError("handshake lost"));
    const res = streamOneOnOneDsh("d1", "p1", "问题？");
    const frames = await collectFrames(res.body!);
    expect(frames).toHaveLength(1);
    expect(JSON.parse(frames[0]).type).toBe("error");
  });
});
