import { beforeEach, describe, it, expect, vi } from "vitest";
import { extractJson, buildGroupPersonaPrompt, runModeratorTurn } from "@/lib/discussion/orchestrator";
import { emptyState } from "@/lib/discussion/state";
import { DshTurnError, DshProtocolError, DshStartFailedError } from "@/lib/dsh/errors";
import { isFatalDiscussionRuntimeError } from "@/lib/dsh/errors";

const mockRunDiscussionDshTurn = vi.fn();
vi.mock("@/lib/discussion/run-dsh-turn", () => ({
  runDiscussionDshTurn: (...args: unknown[]) => mockRunDiscussionDshTurn(...args),
}));

beforeEach(() => mockRunDiscussionDshTurn.mockReset());

describe("orchestrator pure helpers", () => {
  it("extracts a JSON object from plain or wrapped text", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('summary: {"a":1,"b":[2]}')).toEqual({ a: 1, b: [2] });
    expect(() => extractJson("no json here")).toThrow(DshTurnError);
  });

  it("builds a group persona prompt with round, state, history, steers", () => {
    const state = emptyState("brief");
    const prompt = buildGroupPersonaPrompt("张三", "", "brief", 3, state, [{ id: "m1", sender: "李四", role: "persona", content: "观点" }], ["插话1"]);
    expect(prompt).toContain("第 3 轮");
    expect(prompt).toContain("李四：观点");
    expect(prompt).toContain("插话1");
    expect(prompt).toContain("你是 张三");
  });

  it("omits empty history/steers gracefully", () => {
    const prompt = buildGroupPersonaPrompt("张三", "", "brief", 1, emptyState("brief"), [], []);
    expect(prompt).toContain("（尚无，本轮你是第一个发言的）");
  });
});

describe("orchestrator moderator P0 fail-closed", () => {
  it("injects real round message content into the moderator prompt", async () => {
    const state = emptyState("brief");
    mockRunDiscussionDshTurn.mockResolvedValueOnce({ status: "completed", finalText: "not json at all" });
    await runModeratorTurn("d1", 1, state, ["msg-1"], "bt-turn-moderator-c", undefined, 0, [
      { id: "msg-1", sender: "李四", role: "persona", content: "我认为定价过高" },
    ]).catch(() => undefined);
    const prompt = mockRunDiscussionDshTurn.mock.calls[0]?.[0]?.prompt as string;
    expect(prompt).toContain("# 本轮发言记录");
    expect(prompt).toContain("[msg-1] 李四：我认为定价过高");
  });

  it("DshTurnError (model turn failure) does not terminate the whole discussion", () => {
    expect(isFatalDiscussionRuntimeError(new DshTurnError())).toBe(false);
  });

  it("DshProtocolError / DshStartFailedError are fatal for the whole discussion", () => {
    expect(isFatalDiscussionRuntimeError(new DshProtocolError())).toBe(true);
    expect(isFatalDiscussionRuntimeError(new DshStartFailedError())).toBe(true);
  });

  it("never falls back to a truncated proposal when Moderator returns invalid JSON", async () => {
    const state = emptyState("brief");
    mockRunDiscussionDshTurn.mockResolvedValueOnce({ status: "completed", finalText: "not json at all" });
    await expect(
      runModeratorTurn("d1", 1, state, ["msg-1"], "bt-turn-moderator-x")
    ).rejects.toThrow(DshTurnError);
  });

  it("throws on empty Moderator response instead of producing a fake summary", async () => {
    const state = emptyState("brief");
    mockRunDiscussionDshTurn.mockResolvedValueOnce({ status: "completed", finalText: "   " });
    await expect(
      runModeratorTurn("d1", 1, state, ["msg-1"], "bt-turn-moderator-y")
    ).rejects.toThrow(/空回复/);
  });

  it("propagates DSH runtime errors verbatim (no retry, no fallback)", async () => {
    const state = emptyState("brief");
    const boom = new DshProtocolError("wire lost");
    mockRunDiscussionDshTurn.mockRejectedValueOnce(boom);
    await expect(
      runModeratorTurn("d1", 1, state, ["msg-1"], "bt-turn-moderator-z")
    ).rejects.toBe(boom);
  });
});
