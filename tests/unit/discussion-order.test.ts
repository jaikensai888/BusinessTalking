import { describe, expect, it } from "vitest";
import { assignProcessTurns } from "@/lib/discussion/message-order";

const turn = (key: string, sessionId: string, turnNumber?: number, hasFinalMessage = true) => ({
  key,
  sessionId,
  ...(turnNumber === undefined ? {} : { turnNumber }),
  hasFinalMessage,
});

describe("discussion message/process ordering", () => {
  it("assigns each persona reply its process before rendering leftover turns", () => {
    const assignments = assignProcessTurns(
      [
        { id: "reply-1", role: "persona", sender: "RDNXSF", turn: 1, sessionId: "s1" },
        { id: "reply-2", role: "persona", sender: "RDNXSF", turn: 2, sessionId: "s1" },
      ],
      [turn("s1:1", "s1", 1), turn("s1:2", "s1", 2)],
      [],
    );

    expect([...assignments.entries()]).toEqual([["reply-1", "s1:1"], ["reply-2", "s1:2"]]);
  });

  it("uses the persona/session mapping when the persisted message lacks sessionId", () => {
    const assignments = assignProcessTurns(
      [{ id: "reply", role: "persona", sender: "RDNXSF", turn: 1, sessionId: null }],
      [turn("s-rdnxsf", "s-rdnxsf", undefined)],
      [{ sessionId: "s-rdnxsf", personaName: "RDNXSF" }],
    );

    expect(assignments.get("reply")).toBe("s-rdnxsf");
  });

  it("reserves explicit rounds before matching transient turn-zero messages", () => {
    const assignments = assignProcessTurns(
      [
        { id: "reply-before-write", role: "persona", sender: "RDNXSF", turn: 0, sessionId: "s1" },
        { id: "reply-round-2", role: "persona", sender: "RDNXSF", turn: 2, sessionId: "s1" },
      ],
      [turn("s1:1", "s1", 1, false), turn("s1:2", "s1", 2, true)],
      [],
    );

    expect([...assignments.entries()]).toEqual([
      ["reply-round-2", "s1:2"],
      ["reply-before-write", "s1:1"],
    ]);
  });
});
