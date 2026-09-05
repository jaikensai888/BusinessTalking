import { describe, it, expect, vi } from "vitest";
import { extractJson, buildGroupPersonaPrompt, runModeratorTurn } from "@/lib/discussion/orchestrator";
import { emptyState } from "@/lib/discussion/state";
import { DshTurnError, DshProtocolError, DshStartFailedError } from "@/lib/dsh/errors";
import { isFatalDiscussionRuntimeError } from "@/lib/dsh/errors";

vi.mock("@/lib/discussion/dsh-service", () => ({
  runTurnViaDsh: vi.fn(),
  freshTurnSessionId: vi.fn((_d, a) => `bt-turn-${_d}-${a}-x`),
}));

import { runTurnViaDsh } from "@/lib/discussion/dsh-service";

const mockRunTurn = vi.mocked(runTurnViaDsh);

describe("orchestrator pure helpers", () => {
  it("extracts a JSON object from plain or wrapped text", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('summary: {"a":1,"b":[2]}')).toEqual({ a: 1, b: [2] });
    expect(() => extractJson("no json here")).toThrow(DshTurnError);
  });

  it("builds a group persona prompt with round, state, outputs, steers", () => {
    const state = emptyState("brief");
    const prompt = buildGroupPersonaPrompt("张三", "", "brief", 3, state, [{ name: "李四", text: "观点" }], ["插话1"]);
    expect(prompt).toContain("第 3 轮");
    expect(prompt).toContain("李四：观点");
    expect(prompt).toContain("插话1");
    expect(prompt).toContain("你是 张三");
  });

  it("omits empty outputs/steers gracefully", () => {
    const prompt = buildGroupPersonaPrompt("张三", "", "brief", 1, emptyState("brief"), [], []);
    expect(prompt).not.toContain("本轮已完成发言\n\n（尚无）");
    expect(prompt).toContain("（尚无）");
  });
});

describe("orchestrator moderator P0 fail-closed", () => {
  it("DshTurnError (model turn failure) does not terminate the whole discussion", () => {
    expect(isFatalDiscussionRuntimeError(new DshTurnError())).toBe(false);
  });

  it("DshProtocolError / DshStartFailedError are fatal for the whole discussion", () => {
    expect(isFatalDiscussionRuntimeError(new DshProtocolError())).toBe(true);
    expect(isFatalDiscussionRuntimeError(new DshStartFailedError())).toBe(true);
  });

  it("never falls back to a truncated proposal when Moderator returns invalid JSON", async () => {
    const state = emptyState("brief");
    mockRunTurn.mockResolvedValueOnce("not json at all");
    await expect(
      runModeratorTurn("d1", 1, state, ["msg-1"], "bt-turn-moderator-x")
    ).rejects.toThrow(DshTurnError);
  });

  it("throws on empty Moderator response instead of producing a fake summary", async () => {
    const state = emptyState("brief");
    mockRunTurn.mockResolvedValueOnce("   ");
    await expect(
      runModeratorTurn("d1", 1, state, ["msg-1"], "bt-turn-moderator-y")
    ).rejects.toThrow(/空回复/);
  });

  it("propagates DSH runtime errors verbatim (no retry, no fallback)", async () => {
    const state = emptyState("brief");
    const boom = new DshProtocolError("wire lost");
    mockRunTurn.mockRejectedValueOnce(boom);
    await expect(
      runModeratorTurn("d1", 1, state, ["msg-1"], "bt-turn-moderator-z")
    ).rejects.toBe(boom);
  });
});
