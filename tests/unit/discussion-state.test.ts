import { describe, it, expect } from "vitest";
import {
  emptyState,
  parseDiscussionState,
  parseStateProposal,
  DiscussionStateSchema,
} from "@/lib/discussion/state";

describe("discussion state", () => {
  it("produces a valid empty state", () => {
    const s = emptyState("brief");
    expect(s.schemaVersion).toBe(1);
    expect(s.round).toBe(0);
    expect(s.summary).toBe("brief");
    expect(s.evidence).toEqual([]);
    expect(s.participantStatuses).toEqual([]);
    // round-trips through Zod
    expect(DiscussionStateSchema.safeParse(s).success).toBe(true);
  });

  it("strictly parses a valid StateProposal", () => {
    const p = parseStateProposal({
      schemaVersion: 1,
      basedOnStateVersion: 3,
      round: 2,
      summary: "s",
      evidence: [{ id: "e1", claim: "c", sourceMessageIds: ["m1"], sourceEventIds: ["ev1"] }],
      decisions: ["d"],
      openQuestions: ["q"],
      acceptedMessageIds: ["m1"],
    });
    expect(p.basedOnStateVersion).toBe(3);
    expect(p.acceptedMessageIds).toEqual(["m1"]);
  });

  it("rejects an invalid proposal (bad schemaVersion / missing acceptedMessageIds)", () => {
    expect(() =>
      parseStateProposal({ schemaVersion: 2, basedOnStateVersion: 1, round: 1, summary: "", evidence: [], decisions: [], openQuestions: [], acceptedMessageIds: [] })
    ).toThrow(/校验失败/);
    expect(() =>
      parseStateProposal({ schemaVersion: 1, basedOnStateVersion: 1, round: 1, summary: "", evidence: [], decisions: [], openQuestions: [] })
    ).toThrow(/校验失败/);
  });

  it("rejects an invalid DiscussionState (no-brief)", () => {
    expect(() => parseDiscussionState({ schemaVersion: 1, round: 0, summary: "x" })).toThrow(/校验失败/);
  });
});
