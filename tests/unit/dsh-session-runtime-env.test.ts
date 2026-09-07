import { describe, expect, it } from "vitest";
import { buildChildRuntimeEnv } from "../../scripts/dsh-session.mjs";

describe("dsh session runtime environment", () => {
  it("forwards the authenticated internal web-search bridge to the SDK child", () => {
    const source = {
      NODE_ENV: "test" as const,
      BT_INTERNAL_SEARCH_URL: "http://127.0.0.1:3001/api/internal/dsh/web-search",
      BT_INTERNAL_TOKEN: "test-internal-token",
      BT_DSH_APPROVAL_URL: "http://127.0.0.1:3001/api/internal/dsh/approval",
      BT_DSH_APPROVAL_TOKEN: "test-approval-token",
    };

    const childEnv = buildChildRuntimeEnv(source) as NodeJS.ProcessEnv;

    expect(childEnv.BT_INTERNAL_SEARCH_URL).toBe(source.BT_INTERNAL_SEARCH_URL);
    expect(childEnv.BT_INTERNAL_TOKEN).toBe(source.BT_INTERNAL_TOKEN);
    expect(childEnv.BT_DSH_APPROVAL_URL).toBe(source.BT_DSH_APPROVAL_URL);
    expect(childEnv.BT_DSH_APPROVAL_TOKEN).toBe(source.BT_DSH_APPROVAL_TOKEN);
  });
});
