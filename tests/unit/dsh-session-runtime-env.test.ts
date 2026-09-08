import { describe, expect, it } from "vitest";
import { buildChildRuntimeEnv } from "../../scripts/dsh-session.mjs";

describe("dsh session runtime environment", () => {
  it("forwards the DSH search endpoint override to the SDK child", () => {
    const source = {
      NODE_ENV: "test" as const,
      DEEPSEEK_SEARCH_BASE_URL: "https://search.example.test/anthropic/v1",
      BT_DSH_APPROVAL_URL: "http://127.0.0.1:3001/api/internal/dsh/approval",
      BT_DSH_APPROVAL_TOKEN: "test-approval-token",
    };

    const childEnv = buildChildRuntimeEnv(source) as NodeJS.ProcessEnv;

    expect(childEnv.DEEPSEEK_SEARCH_BASE_URL).toBe(source.DEEPSEEK_SEARCH_BASE_URL);
    expect(childEnv.BT_DSH_APPROVAL_URL).toBe(source.BT_DSH_APPROVAL_URL);
    expect(childEnv.BT_DSH_APPROVAL_TOKEN).toBe(source.BT_DSH_APPROVAL_TOKEN);
  });
});
