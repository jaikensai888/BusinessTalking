import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discussionFindUnique: vi.fn(),
  listDiscussionEventsAfter: vi.fn(),
  subscribe: vi.fn(),
  pending: vi.fn(),
  listener: null as ((event: Record<string, unknown>) => void) | null,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    discussion: {
      findUnique: (...args: unknown[]) => mocks.discussionFindUnique(...args),
    },
  },
}));

vi.mock("@/lib/discussion/event-ledger", () => ({
  listDiscussionEventsAfter: (...args: unknown[]) => mocks.listDiscussionEventsAfter(...args),
}));

vi.mock("@/lib/discussion/broadcast", () => ({
  subscribe: (...args: unknown[]) => mocks.subscribe(...args),
}));

vi.mock("@/lib/discussion/approval-bridge", () => ({
  getDiscussionApprovalBridge: () => ({ listPending: (...args: unknown[]) => mocks.pending(...args) }),
}));

import { GET } from "@/app/api/v1/discussions/[id]/stream/route";

const discussion = { id: "d1" };

function dshEvent(discussionSeq: number) {
  return {
    type: "dsh-event",
    discussionId: "d1",
    discussionSeq,
    participantId: "p1",
    sessionId: "stable-session",
    seq: discussionSeq,
    eventType: "tool/call",
    eventTimeMs: discussionSeq,
    data: { name: "read_skill_reference", callId: `call-${discussionSeq}` },
  };
}

async function readFrames(response: Response, count: number): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  while (raw.split("\n\n").filter(Boolean).length < count) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return raw.split("\n\n").filter(Boolean);
}

function eventNames(frames: string[]): string[] {
  return frames.map((frame) => frame.match(/^event: ([^\n]+)/m)?.[1] ?? "message");
}

function frameData(frame: string): Record<string, unknown> {
  const line = frame.split("\n").find((part) => part.startsWith("data: ")) ?? "data: {}";
  return JSON.parse(line.slice("data: ".length)) as Record<string, unknown>;
}

beforeEach(() => {
  for (const mock of [mocks.discussionFindUnique, mocks.listDiscussionEventsAfter, mocks.subscribe, mocks.pending]) {
    mock.mockReset();
  }
  mocks.listener = null;
  mocks.discussionFindUnique.mockResolvedValue(discussion);
  mocks.pending.mockReturnValue([]);
  mocks.subscribe.mockImplementation((_id: string, listener: (event: Record<string, unknown>) => void) => {
    mocks.listener = listener;
    return () => { mocks.listener = null; };
  });
});

describe("Discussion event stream", () => {
  it("subscribes before reading backlog, so an event during the snapshot is not lost", async () => {
    mocks.listDiscussionEventsAfter.mockImplementation(async () => {
      expect(mocks.subscribe).toHaveBeenCalledTimes(1);
      mocks.listener?.(dshEvent(2));
      return [dshEvent(1)];
    });

    const response = await GET(new Request("http://localhost/api/v1/discussions/d1/stream"), {
      params: Promise.resolve({ id: "d1" }),
    });
    const frames = await readFrames(response, 3);

    expect(eventNames(frames)).toEqual(["dsh", "ready", "dsh"]);
    expect(frameData(frames[0]).discussionSeq).toBe(1);
    expect(frameData(frames[2]).discussionSeq).toBe(2);
  });

  it("replays from the selected cursor, sends pending approval without an SSE id, and deduplicates live events", async () => {
    mocks.listDiscussionEventsAfter.mockImplementation(async () => {
      mocks.listener?.(dshEvent(1));
      mocks.listener?.(dshEvent(2));
      return [dshEvent(1), dshEvent(2)];
    });
    mocks.pending.mockReturnValue([{
      approvalId: "approval-1",
      discussionId: "d1",
      sessionId: "stable-session",
      toolName: "tool-bash",
      status: "pending",
      requestedAt: 1,
    }]);

    const response = await GET(new Request("http://localhost/api/v1/discussions/d1/stream?after=0"), {
      params: Promise.resolve({ id: "d1" }),
    });
    const frames = await readFrames(response, 4);

    expect(eventNames(frames)).toEqual(["dsh", "dsh", "ready", "approval"]);
    expect(frames[0]).toContain("id: 1");
    expect(frames[1]).toContain("id: 2");
    expect(frames[3]).not.toContain("id:");
    expect(frameData(frames[3]).approvalId).toBe("approval-1");
  });

  it("gives Last-Event-ID precedence and rejects invalid cursors", async () => {
    mocks.listDiscussionEventsAfter.mockResolvedValue([]);
    const response = await GET(new Request("http://localhost/api/v1/discussions/d1/stream?after=1", {
      headers: { "Last-Event-ID": "5" },
    }), { params: Promise.resolve({ id: "d1" }) });
    await readFrames(response, 1);
    expect(mocks.listDiscussionEventsAfter).toHaveBeenCalledWith("d1", 5);

    const invalid = await GET(new Request("http://localhost/api/v1/discussions/d1/stream?after=-1"), {
      params: Promise.resolve({ id: "d1" }),
    });
    expect(invalid.status).toBe(400);
  });
});
