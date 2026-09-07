import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deleteManifest, writeManifestAtomic, type RuntimeSessionManifest } from "@/lib/dsh/manifest";
import { extractMappedEvent } from "@/lib/dsh/session-events";
import { getDiscussionSessionConfig } from "@/lib/runtime/singleton";
import { DshSessionProcess } from "@/lib/runtime/session-process";
import type { MappedEvent } from "@/lib/dsh/session-events";

interface SmokeResult {
  sessionId: string;
  events: MappedEvent[];
  finalResponse: string;
}

let cleanupSessionId: string | null = null;
let cleanupHome: string | null = null;

async function runSmokeDiscussion(): Promise<SmokeResult> {
  const config = await getDiscussionSessionConfig();
  const sessionId = `e2e-${randomUUID().replaceAll("-", "")}`;
  cleanupSessionId = sessionId;
  cleanupHome = fs.mkdtempSync(path.join(os.tmpdir(), "business-talking-dsh-e2e-"));

  const manifest: RuntimeSessionManifest = {
    schemaVersion: 1,
    sessionId,
    discussionId: `smoke-${sessionId}`,
    kind: "moderator",
    runtimeProfile: {
      provider: config.profile.provider,
      model: config.profile.model,
      baseUrl: config.profile.baseUrl ?? null,
      profileHash: config.profile.profileHash,
    },
    allowedSkills: [],
    toolPolicy: { webSearch: false, sideEffects: false },
    permissions: { mode: "read-only", approvalPolicy: "never" },
  };
  writeManifestAtomic(manifest);

  const events: MappedEvent[] = [];
  const process = new DshSessionProcess({
    ...config.processOptions,
    dshHome: cleanupHome,
    onNotification: (_requestId, notification) => {
      const mapped = extractMappedEvent(notification);
      if (mapped) events.push(mapped);
    },
  });

  try {
    const result = await process.run({
      sessionId,
      prompt: "请用一句简短中文回答：DSH session observability smoke 是否正常？不要调用工具。",
    });
    return { sessionId, events, finalResponse: result.finalResponse };
  } finally {
    await process.close();
  }
}

afterEach(() => {
  if (cleanupSessionId) deleteManifest(cleanupSessionId);
  cleanupSessionId = null;
  if (cleanupHome) fs.rmSync(cleanupHome, { recursive: true, force: true });
  cleanupHome = null;
});

describe("real DSH session observability smoke", () => {
  it.runIf(process.env.RUN_DSH_E2E === "1")("forwards live native session events", async () => {
    const result = await runSmokeDiscussion();
    expect(result.finalResponse.trim()).not.toBe("");
    expect(result.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["turn/start", "assistant/message", "turn/end"]),
    );
    expect(result.events.every((event) => event.sessionId === result.sessionId)).toBe(true);
    expect(result.events.every((event) => Number.isSafeInteger(event.seq))).toBe(true);
  });
});
