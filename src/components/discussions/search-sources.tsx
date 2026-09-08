import type { DshToolView } from "@/lib/discussion/dsh-turn-projection";

export function collectSearchSources(tools: DshToolView[]): Array<{ title: string; url: string }> {
  const sources = new Map<string, string>();
  const visit = (value: unknown, depth = 0) => {
    if (depth > 6 || !value) return;
    if (typeof value === "string") { try { visit(JSON.parse(value), depth + 1); } catch { /* Plain text. */ } return; }
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return; }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.url === "string" && /^https?:\/\//i.test(record.url)) sources.set(record.url, typeof record.title === "string" ? record.title : record.url);
    for (const key of ["sources", "content", "text", "results"]) if (record[key]) visit(record[key], depth + 1);
  };
  tools.filter((tool) => tool.name === "web_search").forEach((tool) => visit(tool.output));
  return [...sources].map(([url, title]) => ({ url, title }));
}

export function SearchSources({ tools }: { tools: DshToolView[] }) {
  const sources = collectSearchSources(tools);
  if (!sources.length) return null;
  return <details className="mt-3 text-caption text-ink-48"><summary className="cursor-pointer py-2 hover:text-primary">参考来源 · {sources.length}</summary>
    <ul className="space-y-1">{sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer" className="block rounded-sm px-2 py-2 text-primary underline-offset-4 hover:bg-parchment hover:underline">{source.title}</a></li>)}</ul>
  </details>;
}
