import { describe, it, expect } from "vitest";
import {
  isDshError,
  dshErrorCode,
  isFatalDiscussionRuntimeError,
  DshError,
  DshStartFailedError,
  DshInitializeFailedError,
  DshProtocolError,
  DshRouteUnsupportedError,
  DshCredentialInvalidError,
  DshManifestError,
  DshSkillNotAllowedError,
  DshSessionBusyError,
  DshRuntimeProfileConflictError,
  DshTurnError,
  DiscussionStateConflictError,
  DiscussionArchivedError,
} from "@/lib/dsh/errors";

describe("dsh error classification contract", () => {
  it("isDshError recognizes stable DshError instances and rejects plain errors", () => {
    expect(isDshError(new DshTurnError())).toBe(true);
    expect(isDshError(new DshProtocolError())).toBe(true);
    expect(isDshError(new Error("boom"))).toBe(false);
    expect(isDshError("string error")).toBe(false);
    expect(isDshError(undefined)).toBe(false);
  });

  it("dshErrorCode returns the stable code or undefined", () => {
    expect(dshErrorCode(new DshManifestError())).toBe("DSH_MANIFEST_INVALID");
    expect(dshErrorCode(new DshTurnError())).toBe("DSH_TURN_FAILED");
    expect(dshErrorCode(new Error("x"))).toBeUndefined();
  });

  it("classifies runtime/protocol/manifest/permission errors as fatal", () => {
    const fatal: unknown[] = [
      new DshStartFailedError(),
      new DshInitializeFailedError(),
      new DshProtocolError(),
      new DshRouteUnsupportedError(),
      new DshCredentialInvalidError(),
      new DshManifestError(),
      new DshSkillNotAllowedError(),
      new DshSessionBusyError(),
      new DshRuntimeProfileConflictError(),
      new DiscussionStateConflictError(),
      new DiscussionArchivedError(),
    ];
    for (const e of fatal) {
      expect(isFatalDiscussionRuntimeError(e), `expected fatal: ${String(e)}`).toBe(true);
    }
  });

  it("classifies a plain model turn error as continuable (not fatal)", () => {
    expect(isFatalDiscussionRuntimeError(new DshTurnError())).toBe(false);
  });

  it("classifies unknown Error as fatal by default (fail-closed)", () => {
    expect(isFatalDiscussionRuntimeError(new Error("unexpected"))).toBe(true);
    expect(isFatalDiscussionRuntimeError("raw string")).toBe(true);
  });

  it("DshError carries the stable code used by classifiers", () => {
    const e = new DshError("DSH_PROTOCOL_FAILED", "wire error");
    expect(isDshError(e)).toBe(true);
    expect(dshErrorCode(e)).toBe("DSH_PROTOCOL_FAILED");
  });
});
