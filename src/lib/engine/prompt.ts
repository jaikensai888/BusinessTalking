/** Prompt 组装：注入 skill 指令 + 人格质询视角 + 输出要求 */

interface SkillLike {
  name: string;
  instructions: string;
  outputSchema?: unknown;
}

interface PersonaLike {
  name: string;
  systemPrompt: string;
}

export function buildStepSystem(skill: SkillLike, persona: PersonaLike | null): string {
  const parts = [skill.instructions];
  if (persona) {
    parts.push(
      `\n\n【质询视角】本步骤同时以「${persona.name}」的身份对分析过程进行审视与质询，确保不遗漏该视角关注的漏洞。\n${persona.systemPrompt}`
    );
  }
  const schema = skill.outputSchema as { properties?: Record<string, unknown> } | null | undefined;
  if (schema?.properties && Object.keys(schema.properties).length > 0) {
    parts.push(
      `\n\n【输出要求】你必须只输出一个 JSON 对象，包含以下字段：${Object.keys(schema.properties).join(
        ", "
      )}。不要输出任何其他文字、解释或 Markdown 代码块。`
    );
  }
  return parts.join("\n");
}

export function buildStepUser(ideaInput: string, previousOutput: unknown | null): string {
  const parts = [`【商业想法】\n${ideaInput}`];
  if (previousOutput !== null && previousOutput !== undefined) {
    parts.push(
      `\n【上一步分析结果】\n${
        typeof previousOutput === "string" ? previousOutput : JSON.stringify(previousOutput, null, 2)
      }`
    );
  }
  parts.push("\n请基于以上内容完成你的分析步骤。");
  return parts.join("\n");
}
