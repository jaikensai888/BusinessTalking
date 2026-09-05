import { describe, it, expect } from "vitest";
import {
  extractEvent,
  sanitizeData,
  extractAssistantText,
  isFinalAssistantMessage,
} from "@/lib/dsh/events";

describe("dsh event projection — pure transforms", () => {
  it("maps session.event -> MappedEvent and ignores other methods", () => {
    const n = {
      method: "session.event",
      params: {
        sessionId: "bt-s",
        event: { type: "assistant/message", seq: 12, data: { content: [{ type: "text", text: "hi" }] } },
      },
    };
    const m = extractEvent(n);
    expect(m).toEqual({ sessionId: "bt-s", seq: 12, eventType: "assistant/message", data: { content: [{ type: "text", text: "hi" }] } });
    expect(extractEvent({ method: "session.status", params: { sessionId: "bt-s", status: "running" } })).toBeNull();
    expect(extractEvent({ method: "session.event", params: {} })).toBeNull();
  });

  it("sanitizes credentials and internal absolute paths", () => {
    const out = sanitizeData({
      apiKey: "sk-secret",
      authorization: "Bearer x",
      path: "G:\\claude_project\\code-agent\\business-talking\\src",
      token: "drop",
      ok: { nested: "keep", token: "drop" },
      arr: ["a"],
    }) as Record<string, unknown>;
    expect(out.apiKey).toBeUndefined();
    expect(out.authorization).toBeUndefined();
    expect(out.token).toBeUndefined();
    expect(out.path).toBe("[redacted]");
    expect((out.ok as Record<string, unknown>).nested).toBe("keep");
    expect((out.ok as Record<string, unknown>).token).toBeUndefined();
    expect(out.arr).toEqual(["a"]);
  });

  it("extracts final assistant text from message content blocks", () => {
    expect(
      extractAssistantText({ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } })
    ).toBe("ab");
    // 兼容顶层 content 形状
    expect(extractAssistantText({ content: [{ type: "text", text: "x" }] })).toBe("x");
  });

  it("recognizes final assistant message events", () => {
    expect(isFinalAssistantMessage("assistant/message")).toBe(true);
    expect(isFinalAssistantMessage("assistant/chunk")).toBe(false);
    expect(isFinalAssistantMessage("turn/start")).toBe(false);
  });
});
