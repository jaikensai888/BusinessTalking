import { describe, it, expect } from "vitest";
import { mapRunnerError } from "@/lib/runtime/turn-process";
import {
  DshStartFailedError,
  DshManifestError,
  DshRouteUnsupportedError,
  DshCredentialInvalidError,
  DshSkillNotAllowedError,
  DshTurnError,
  DshProtocolError,
} from "@/lib/dsh/errors";

describe("dsh turn-process error mapping", () => {
  it("maps startup/handshake failures to DshStartFailedError", () => {
    expect(mapRunnerError("DSH_START_FAILED", "spawn failed")).toBeInstanceOf(DshStartFailedError);
    expect(mapRunnerError("DSH_INITIALIZE_FAILED", "handshake boom")).toBeInstanceOf(DshStartFailedError);
  });

  it("maps manifest errors to DshManifestError", () => {
    expect(mapRunnerError("DSH_MANIFEST_INVALID", "manifest corrupt")).toBeInstanceOf(DshManifestError);
  });

  it("maps route/credential/skill errors to their specific classes", () => {
    expect(mapRunnerError("DSH_ROUTE_UNSUPPORTED", "no route")).toBeInstanceOf(DshRouteUnsupportedError);
    expect(mapRunnerError("DSH_CREDENTIAL_INVALID", "no key")).toBeInstanceOf(DshCredentialInvalidError);
    expect(mapRunnerError("DSH_SKILL_NOT_ALLOWED", "denied")).toBeInstanceOf(DshSkillNotAllowedError);
  });

  it("defaults unknown or missing codes to fatal DshProtocolError", () => {
    expect(mapRunnerError(undefined, "boom")).toBeInstanceOf(DshProtocolError);
    expect(mapRunnerError("SOME_OTHER_CODE", "boom")).toBeInstanceOf(DshProtocolError);
  });

  it("truncates long error messages to a safe short form", () => {
    const long = "x".repeat(2000);
    const e = mapRunnerError("DSH_MANIFEST_INVALID", long);
    expect(e.message.length).toBeLessThanOrEqual(500);
  });

  it("classifies a plain model turn error from a malformed response as DshTurnError", () => {
    // 模拟 runner ok:true 但 finalResponse 非字符串 → turn-process 会抛 DshTurnError；
    // 这里直接验证映射函数对 DSH_TURN_FAILED 的处理
    expect(mapRunnerError("DSH_TURN_FAILED", "empty response")).toBeInstanceOf(DshTurnError);
  });

  it("keeps DshProtocolError semantics intact for parse failures", () => {
    // 结构映射的解析异常路径由 spawn 层处理；此处确认类存在且可构造
    const e = new DshProtocolError("bad json");
    expect(e.code).toBe("DSH_PROTOCOL_FAILED");
  });
});
