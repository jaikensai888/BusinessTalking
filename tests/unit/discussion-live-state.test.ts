import { describe, expect, it } from "vitest";
import { getOneOnOneFailure, hasNewPersonaReply, isOneOnOneReplyPending } from "@/lib/discussion/live-state";

describe("discussion live state", () => {
  it("does not treat an earlier persona reply as the current reply", () => {
    const before = [
      { role: "user", content: "第一个问题" },
      { role: "persona", content: "第一个回答" },
      { role: "user", content: "第二个问题" },
    ];

    expect(hasNewPersonaReply(before, 1)).toBe(false);
    expect(hasNewPersonaReply([...before, { role: "persona", content: "第二个回答" }], 1)).toBe(true);
  });

  it("keeps a ready 1v1 discussion live while the latest message is a user question", () => {
    expect(
      isOneOnOneReplyPending({
        status: "ready",
        personas: [{ id: "persona-1" }],
        messages: [{ role: "user", content: "首个问题" }],
      })
    ).toBe(true);

    expect(
      isOneOnOneReplyPending({
        status: "ready",
        personas: [{ id: "persona-1" }],
        messages: [
          { role: "user", content: "首个问题" },
          { role: "persona", content: "回答" },
        ],
      })
    ).toBe(false);
  });

  it("surfaces a failed 1v1 participant and stops the thinking state", () => {
    const snapshot = {
      status: "ready",
      personas: [{ id: "persona-1" }],
      messages: [{ role: "user", content: "首个问题" }],
      participants: [{ status: "failed", lastError: "连接 DeepSeek 失败" }],
    };

    expect(getOneOnOneFailure(snapshot)).toBe("连接 DeepSeek 失败");
    expect(isOneOnOneReplyPending(snapshot)).toBe(false);
  });

  it("provides a fallback when a failed discussion has no participant error", () => {
    expect(
      getOneOnOneFailure({
        status: "failed",
        personas: [{ id: "persona-1" }],
        participants: [{ status: "failed", lastError: null }],
      })
    ).toBe("讨论失败，请稍后重试");
  });
});
