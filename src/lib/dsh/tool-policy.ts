/**
 * P0 工具 policy 契约（见 dsh-p0-remediation-execution-plan.md Task 1.3）。
 *
 * 单一事实来源：模型可见 schema 与实际执行 guard 必须使用同一份 allowlist。
 *  - 保留的 DSH Skill tool：`skill`（DSH 自带，BusinessTalking 只提供 scoped provider）。
 *  - BusinessTalking 只读工具：`read_skill_reference`。
 *  - `web_search`：仅当 manifest.toolPolicy.webSearch 明确允许时注册；P0 默认关闭。
 *
 * 任何 manifest 数据或 prompt 修改都不能把本 allowlist 之外的名称放行。
 */

import type { ToolPolicy } from "./manifest";

/** 始终允许的只读工具（与 manifest 无关的固定能力） */
export const DFH_READ_ONLY_TOOLS = readonly(["skill", "read_skill_reference"]);

/** 可选的网络搜索工具：只有 manifest.toolPolicy.webSearch 明确允许时才可加入 */
export const CONDITIONAL_WEB_SEARCH_TOOL = "web_search";

/** 已知必须拒绝的副作用/外部工具名（用于测试与诊断，不参与执行） */
export const KNOWN_FORBIDDEN_TOOLS = readonly([
  "tool-bash",
  "tool-pwsh",
  "tool-fs",
  "tool-fs-search",
  "tool-str-replace-editor",
  "tool-subagent",
  "tool-subagent-fork",
  "tool-subagent-control",
  "tool-subagent-list-agents",
  "tool-ralph",
  "tool-web",
  "tool-goal",
  "tool-todo",
  "tool-workflow",
  "tool-jobs",
  "web-fetch-http",
  "web-search-deepseek",
]);

/** 根据 manifest 的 toolPolicy 计算该 Session 实际允许的工具集合。 */
export function p0ToolAllowlist(policy: ToolPolicy): readonly string[] {
  return policy.webSearch ? [...DFH_READ_ONLY_TOOLS, CONDITIONAL_WEB_SEARCH_TOOL] : DFH_READ_ONLY_TOOLS;
}

/** 判断工具名是否允许给工具 guard 使用（唯一执行边界）。 */
export function isP0ToolAllowed(name: string, policy: ToolPolicy): boolean {
  return p0ToolAllowlist(policy).includes(name);
}

/** 固化数组引用，避免外部意外修改 allowlist（执行期间只读）。 */
function readonly<T extends readonly string[]>(arr: T): T {
  return Object.freeze([...arr]) as T;
}
