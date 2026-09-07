import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  searchWeb: vi.fn(),
}));

vi.mock("@/lib/runtime/internal-endpoints", () => ({
  getDshInternalToken: mocks.getToken,
}));
vi.mock("@/lib/search/web", () => ({
  searchWeb: mocks.searchWeb,
}));

import { POST } from "@/app/api/internal/dsh/web-search/route";

function request(body: unknown, token = "internal-token") {
  return new Request("http://localhost/api/internal/dsh/web-search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-bt-internal-token": token },
    body: JSON.stringify(body),
  });
}

describe("internal DSH web-search route", () => {
  beforeEach(() => {
    mocks.getToken.mockReset().mockReturnValue("internal-token");
    mocks.searchWeb.mockReset().mockResolvedValue("1. result");
  });

  it("requires the internal token and forwards only bounded search input", async () => {
    const unauthorized = await POST(request({ query: "secret" }, "wrong"));
    expect(unauthorized.status).toBe(403);
    expect(mocks.searchWeb).not.toHaveBeenCalled();

    const response = await POST(request({ query: "latest AI product", maxResults: 3 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: "1. result" });
    expect(mocks.searchWeb).toHaveBeenCalledWith("latest AI product", 3);
  });

  it("rejects malformed or oversized search requests", async () => {
    expect((await POST(request({ query: "" }))).status).toBe(400);
    expect((await POST(request({ query: "q", maxResults: 0 }))).status).toBe(400);
    expect((await POST(request({ query: "q", maxResults: 21 }))).status).toBe(400);
    expect((await POST(request({ query: "q", extra: true }))).status).toBe(400);
    expect(mocks.searchWeb).not.toHaveBeenCalled();
  });
});
