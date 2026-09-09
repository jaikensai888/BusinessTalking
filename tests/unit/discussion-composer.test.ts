import { describe, expect, it } from "vitest";
import { composerStatus, composerTarget } from "@/lib/discussion/composer-state";

describe("discussion composer state", () => {
  it("keeps the active recipient visible for one-on-one and follow-up messages", () => {
    expect(composerTarget({ followUpName: "张一鸣", isOne: true, personaName: "张一鸣" })).toBe("追问 张一鸣");
    expect(composerTarget({ followUpName: null, isOne: true, personaName: "张一鸣" })).toBe("发送给 张一鸣");
    expect(composerTarget({ followUpName: null, isOne: false, personaName: "" })).toBe("发送给所有人");
  });

  it("describes waiting as an editable state instead of a disabled empty control", () => {
    expect(composerStatus({ pendingApproval: false, sending: true })).toEqual({
      label: "等待回复",
      hint: "正在等待回复 · 可以继续编辑下一条",
    });
    expect(composerStatus({ pendingApproval: true, sending: false })).toEqual({
      label: "等待审批",
      hint: "请先处理上方审批；草稿会保留。",
    });
  });
});
