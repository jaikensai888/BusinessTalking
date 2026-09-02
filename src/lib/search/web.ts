interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** 解析 DuckDuckGo HTML 结果页（keyless）：提取 result__a 标题/snippet */
function parseDdg(html: string): WebResult[] {
  const out: WebResult[] = [];
  const anchorRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
  const snipRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)<\/a>/gs;
  const anchors = [...html.matchAll(anchorRe)];
  const snippets = [...html.matchAll(snipRe)];
  for (let i = 0; i < Math.min(anchors.length, 8); i++) {
    const url = anchors[i][1];
    const title = stripTags(anchors[i][2]);
    const snippet = snippets[i] ? stripTags(snippets[i][1]) : "";
    if (title) out.push({ title, url, snippet });
  }
  return out;
}

/**
 * 联网搜索（keyless，默认 DuckDuckGo HTML）。返回给模型的一段文本：
 * 结果列表。失败/为空时返回说明，模型可据此判断是否用自己知识。
 */
export async function searchWeb(query: string, maxResults = 8): Promise<string> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal: AbortSignal.timeout(20000),
    });
    const html = await res.text();
    const results = parseDdg(html).slice(0, maxResults);
    if (results.length === 0) return "（未找到相关搜索结果）";
    return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`).join("\n\n");
  } catch (e) {
    return `（联网搜索失败：${e instanceof Error ? e.message : String(e)}）`;
  }
}
