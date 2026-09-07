import { describe, expect, it } from "vitest";
import { isApprovalResolutionStatus } from "@/components/discussions/dsh-approval-panel";

describe("DSH approval panel resolution", () => {
  it("treats accepted and already-decided responses as resolved", () => {
    expect(isApprovalResolutionStatus("accepted")).toBe(true);
    expect(isApprovalResolutionStatus("already-decided")).toBe(true);
    expect(isApprovalResolutionStatus("rejected")).toBe(false);
    expect(isApprovalResolutionStatus("approval_not_found")).toBe(false);
  });
});
