import { randomBytes } from "node:crypto";

const runtimeGlobal = globalThis as typeof globalThis & {
  __businessTalkingDshApprovalToken?: string;
  __businessTalkingDshInternalToken?: string;
};

/**
 * Return the token shared only by this BusinessTalking server process and its
 * DSH children. An explicit deployment token wins; local development gets a
 * random fail-closed token instead of silently disabling the approval bridge.
 */
export function getDshApprovalToken(): string {
  const configured = process.env.BT_DSH_APPROVAL_TOKEN?.trim();
  if (configured) return configured;
  if (!runtimeGlobal.__businessTalkingDshApprovalToken) {
    runtimeGlobal.__businessTalkingDshApprovalToken = randomBytes(32).toString("hex");
  }
  return runtimeGlobal.__businessTalkingDshApprovalToken;
}

/** Resolve the local approval endpoint; deployments may override it explicitly. */
export function getDshApprovalUrl(): string {
  const configured = process.env.BT_DSH_APPROVAL_URL?.trim();
  if (configured) return configured;
  const port = /^\d{1,5}$/.test(process.env.PORT?.trim() ?? "") ? process.env.PORT!.trim() : "3001";
  return `http://127.0.0.1:${port}/api/internal/dsh/approval`;
}

/** Token shared only by this BusinessTalking server process and DSH children for internal search. */
export function getDshInternalToken(): string {
  const configured = process.env.BT_INTERNAL_TOKEN?.trim();
  if (configured) return configured;
  if (!runtimeGlobal.__businessTalkingDshInternalToken) {
    runtimeGlobal.__businessTalkingDshInternalToken = randomBytes(32).toString("hex");
  }
  return runtimeGlobal.__businessTalkingDshInternalToken;
}

/** Resolve the local authenticated DSH web-search endpoint. */
export function getDshInternalSearchUrl(): string {
  const configured = process.env.BT_INTERNAL_SEARCH_URL?.trim();
  if (configured) return configured;
  const port = /^\d{1,5}$/.test(process.env.PORT?.trim() ?? "") ? process.env.PORT!.trim() : "3001";
  return `http://127.0.0.1:${port}/api/internal/dsh/web-search`;
}
