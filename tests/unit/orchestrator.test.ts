import { describe, it, expect } from "vitest";
import { extractJson, buildGroupPersonaPrompt } from "@/lib/discussion/orchestrator";
import { emptyState } from "@/lib/discussion/state";
import { DshTurnError } from "@/lib/dsh/errors";

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
