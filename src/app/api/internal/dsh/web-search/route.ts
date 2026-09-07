import { getDshInternalToken } from "@/lib/runtime/internal-endpoints";
import { searchWeb } from "@/lib/search/web";

export const dynamic = "force-dynamic";

const TOKEN_HEADER = "x-bt-internal-token";
const MAX_QUERY_LENGTH = 2_000;
const MAX_RESULTS = 20;

function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided || provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: Request) {
  if (!tokenMatches(request.headers.get(TOKEN_HEADER), getDshInternalToken())) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isRecord(body) || Object.keys(body).some((key) => key !== "query" && key !== "maxResults")) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const maxResults = body.maxResults === undefined ? 8 : body.maxResults;
  if (!query || query.length > MAX_QUERY_LENGTH) {
    return Response.json({ error: "query must be 1-2000 characters" }, { status: 400 });
  }
  if (typeof maxResults !== "number" || !Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS) {
    return Response.json({ error: `maxResults must be an integer from 1 to ${MAX_RESULTS}` }, { status: 400 });
  }

  try {
    return Response.json({ results: await searchWeb(query, maxResults) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 300) : "web_search_failed" }, { status: 502 });
  }
}
