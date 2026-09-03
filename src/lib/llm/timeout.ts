/**
 * 计算 LLM 调用超时（毫秒）。
 *
 * 按用户设置 llm.timeoutSeconds 生效；上限 600s（与设置表单校验的 30~600 一致），
 * 避免无限挂起，同时允许长回答/多步工具调用不被旧硬顶 120s 提前掐断。
 */
export function llmTimeoutMs(timeoutRaw?: unknown): number {
  const secs = Number(timeoutRaw ?? 120);
  const s = Number.isFinite(secs) && secs > 0 ? secs : 120;
  return Math.min(s * 1000, 600_000);
}
