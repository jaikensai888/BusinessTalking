import path from "node:path";
import { describe, expect, it } from "vitest";
import { runtimeDshHome } from "@/lib/runtime/singleton";

describe("runtime singleton paths", () => {
  it("keeps the DSH home inside the project data directory", () => {
    expect(runtimeDshHome("G:/business-talking")).toBe(path.join("G:/business-talking", "data", "dsh-home"));
  });
});
