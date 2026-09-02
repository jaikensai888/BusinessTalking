/** 输出校验：解析 LLM 文本中的 JSON，并按 skill outputSchema 校验必需字段 */

/** 从 LLM 输出文本中提取 JSON 对象 */
export function extractJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fallthrough */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fallthrough */
    }
  }
  const brace = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (brace !== -1 && end > brace) {
    try {
      return JSON.parse(trimmed.slice(brace, end + 1));
    } catch {
      /* fallthrough */
    }
  }
  return null;
}

/** 校验解析结果是否满足 outputSchema 的必需字段 */
export function validateOutput(
  outputSchema: unknown,
  parsed: unknown
): { ok: boolean; error?: string } {
  if (!outputSchema || typeof outputSchema !== "object") return { ok: true };
  const schema = outputSchema as { required?: string[]; properties?: Record<string, unknown> };
  const required =
    Array.isArray(schema.required) && schema.required.length > 0
      ? schema.required
      : schema.properties
        ? Object.keys(schema.properties)
        : [];
  if (required.length === 0) return { ok: true };
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "输出不是 JSON 对象" };
  }
  const missing = required.filter((k) => !(k in (parsed as Record<string, unknown>)));
  if (missing.length > 0) return { ok: false, error: `缺少必需字段：${missing.join(", ")}` };
  return { ok: true };
}
