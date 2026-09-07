import { describe, expect, it } from "vitest";
import {
  MAX_RUNNER_FRAME_BYTES,
  extractMappedEvent,
  parseRunnerFrame,
  projectClientEvent,
} from "@/lib/dsh/session-events";

function notification(event: Record<string, unknown>) {
  return {
    method: "session.event",
    params: {
      sessionId: "bt-discussion-d1-p1",
      event,
    },
  };
}

describe("DSH session event and runner frame contracts", () => {
  it("keeps a finite native event time and nulls invalid times", () => {
    expect(
      extractMappedEvent(notification({ type: "turn/start", seq: 1, time: 1730000000123, data: {} })),
    ).toMatchObject({
      sessionId: "bt-discussion-d1-p1",
      seq: 1,
      eventType: "turn/start",
      eventTimeMs: 1730000000123,
    });
    expect(extractMappedEvent(notification({ type: "turn/end", seq: 2, time: Infinity, data: {} }))).toMatchObject({
      eventTimeMs: null,
    });
  });

  it("parses only the documented JSONL runner frames", () => {
    const frame = {
      type: "event",
      requestId: "request-1",
      sessionId: "session-1",
      notification: { method: "session.event", params: { sessionId: "session-1", event: { type: "turn/start", seq: 1 } } },
    };
    expect(parseRunnerFrame(JSON.stringify(frame))).toEqual(frame);
    expect(parseRunnerFrame(JSON.stringify({ type: "ready" }))).toEqual({ type: "ready" });
    expect(() => parseRunnerFrame("   ")).toThrow(/empty/);
    expect(() => parseRunnerFrame("{broken-json")).toThrow(/JSON/);
    expect(() => parseRunnerFrame(JSON.stringify({ type: "done", requestId: 1 }))).toThrow(/requestId/);
    expect(() => parseRunnerFrame(JSON.stringify({ type: "done", requestId: "r", sessionId: 1, finalResponse: "ok" }))).toThrow(/sessionId/);
    expect(() => parseRunnerFrame(JSON.stringify({ type: "unknown" }))).toThrow(/frame type/);
    expect(() => parseRunnerFrame("x".repeat(MAX_RUNNER_FRAME_BYTES + 1))).toThrow(/large/);
  });

  it("projects only safe tool, assistant, and approval fields for the browser", () => {
    const mapped = extractMappedEvent(
      notification({
        type: "tool/call",
        seq: 3,
        time: 100,
        data: {
          callId: "call-1",
          name: "read_skill_reference",
          arguments: {
            skillName: "persona-profile",
            relativePath: "references/guide.md",
            apiKey: "must-not-leak",
            path: "G:\\claude_project\\code-agent\\business-talking\\secret.txt",
          },
          headers: { authorization: "Bearer secret" },
        },
      }),
    );
    expect(mapped).not.toBeNull();
    expect(projectClientEvent(mapped!)).toEqual({
      callId: "call-1",
      name: "read_skill_reference",
      arguments: {
        skillName: "persona-profile",
        relativePath: "references/guide.md",
        path: "[redacted]",
      },
    });

    const assistant = extractMappedEvent(
      notification({
        type: "assistant/message",
        seq: 4,
        data: {
          message: {
            content: [
              { type: "text", text: "visible" },
              { type: "reasoning", text: "emitted reasoning" },
              { type: "tool-call", name: "hidden" },
            ],
          },
        },
      }),
    );
    expect(projectClientEvent(assistant!)).toEqual({
      content: [
        { type: "text", text: "visible" },
        { type: "reasoning", text: "emitted reasoning" },
      ],
    });

    const approval = extractMappedEvent(
      notification({
        type: "approval/asked",
        seq: 5,
        data: { id: "approval-1", toolName: "tool-bash", callId: "call-1", reason: "needs approval", arguments: { command: "rm -rf" } },
      }),
    );
    expect(projectClientEvent(approval!)).toEqual({
      id: "approval-1",
      toolName: "tool-bash",
      callId: "call-1",
      reason: "needs approval",
    });
  });

  it("projects nested DSH tool results onto the original tool call", () => {
    const mapped = extractMappedEvent(
      notification({
        type: "tool/result",
        seq: 6,
        time: 120,
        data: {
          message: {
            source: { kind: "tool", callId: "call-1" },
            content: [{
              type: "tool-result",
              toolCallId: "call-1",
              content: [{ type: "text", text: "Error: web_search 不可用" }],
              isError: true,
            }],
          },
        },
      }),
    );
    expect(projectClientEvent(mapped!)).toEqual({
      callId: "call-1",
      status: "error",
      error: "Error: web_search 不可用",
    });
  });
});
