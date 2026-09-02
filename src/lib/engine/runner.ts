import { Prisma } from "@prisma/client";
import { generateText } from "ai";
import { prisma } from "@/lib/db";
import { buildModel } from "@/lib/llm/providers";
import { normalizeProvider } from "@/lib/llm/constants";
import { decrypt } from "@/lib/settings/encryption";
import { getSetting } from "@/lib/settings/store";
import { buildStepSystem, buildStepUser } from "./prompt";
import { extractJson, validateOutput } from "./schemas";

export interface StepSnapshot {
  position: number;
  skill: { name: string; instructions: string; outputSchema: unknown } | null;
  persona: { name: string; systemPrompt: string } | null;
}

export interface RecipeSnapshot {
  name: string;
  steps: StepSnapshot[];
}

/** 从配方构建执行快照（含 skill 指令与人格提示词，配方后续修改不影响本次运行） */
export async function buildSnapshot(recipeId: string): Promise<RecipeSnapshot> {
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: {
      steps: {
        orderBy: { position: "asc" },
        include: {
          skill: { select: { name: true, instructions: true, outputSchema: true } },
          persona: { select: { name: true, systemPrompt: true } },
        },
      },
    },
  });
  if (!recipe) throw new Error("配方不存在");
  return {
    name: recipe.name,
    steps: recipe.steps.map((s) => ({
      position: s.position,
      skill: s.skill ? { name: s.skill.name, instructions: s.skill.instructions, outputSchema: s.skill.outputSchema } : null,
      persona: s.persona ? { name: s.persona.name, systemPrompt: s.persona.systemPrompt } : null,
    })),
  };
}

/**
 * 执行配方主循环（异步推进）：
 * 逐步骤调用 LLM（skill 指令 + 人格视角）→ 校验输出 → 传下一步 → 末步生成最终报告
 * 支持断点续跑：已 done 的步骤跳过、skipped 的步骤跳过、failed/pending 的步骤执行
 */
export async function runRecipe(runId: string) {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });
  if (!run) return;
  const snapshot = run.recipeSnapshot as unknown as RecipeSnapshot;

  const [providerRaw, baseUrl, keyCipher, modelRaw, timeoutRaw] = await Promise.all([
    getSetting("llm.provider"),
    getSetting("llm.baseUrl"),
    getSetting("llm.apiKey"),
    getSetting("llm.defaultModel"),
    getSetting("llm.timeoutSeconds"),
  ]);
  const provider = normalizeProvider(providerRaw);
  const apiKey = keyCipher ? decrypt(keyCipher) : "";

  if (!apiKey) {
    await prisma.run.update({
      where: { id: runId },
      data: { status: "failed", error: "未配置有效的 API Key，请先在设置中填写", completedAt: new Date() },
    });
    return;
  }

  await prisma.run.update({
    where: { id: runId },
    data: { status: "running", startedAt: run.startedAt ?? new Date(), provider, model: modelRaw ?? "" },
  });

  let previous: unknown = run.ideaInput;

  try {
    for (const step of snapshot.steps) {
      let runStep = run.steps.find((s) => s.stepIndex === step.position);
      if (!runStep) {
        runStep = await prisma.runStep.create({
          data: {
            runId,
            stepIndex: step.position,
            skillName: step.skill?.name ?? "未知步骤",
            personaName: step.persona?.name ?? null,
            input: { idea: run.ideaInput },
            status: "running",
          },
        });
      }

      // 已完成/已跳过步骤直接传递
      if (runStep.status === "done") {
        if (runStep.output !== null) previous = runStep.output;
        continue;
      }
      if (runStep.status === "skipped") {
        continue;
      }

      await prisma.runStep.update({ where: { id: runStep.id }, data: { status: "running", error: null } });
      await prisma.run.update({ where: { id: runId }, data: { currentStep: step.position } });
      await prisma.runStep.update({
        where: { id: runStep.id },
        data: { input: { idea: run.ideaInput, previous } as Prisma.InputJsonValue },
      });

      const t0 = Date.now();
      try {
        const modelObj = buildModel(provider, apiKey, modelRaw ?? "", baseUrl || undefined);
        const { text } = await generateText({
          model: modelObj,
          system: buildStepSystem(
            step.skill ?? { name: "分析", instructions: "执行分析步骤。" },
            step.persona
          ),
          prompt: buildStepUser(run.ideaInput, previous),
          abortSignal: AbortSignal.timeout(Math.min(Number(timeoutRaw ?? 120) * 1000, 120000)),
        });

        let output: unknown = text;
        if (step.skill?.outputSchema) {
          const parsed = extractJson(text);
          const check = validateOutput(step.skill.outputSchema, parsed);
          if (!check.ok || parsed === null) {
            throw new Error(`输出未通过 Schema 校验：${check.error ?? "无法解析 JSON"}`);
          }
          output = parsed;
        }

        await prisma.runStep.update({
          where: { id: runStep.id },
          data: { output: output as Prisma.InputJsonValue, status: "done", durationMs: Date.now() - t0, error: null },
        });
        previous = output;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await prisma.runStep.update({
          where: { id: runStep.id },
          data: { status: "failed", error: msg, durationMs: Date.now() - t0 },
        });
        await prisma.run.update({
          where: { id: runId },
          data: { status: "failed", error: `步骤 ${step.position} 执行失败：${msg}`, completedAt: new Date() },
        });
        return;
      }
    }

    // 全部步骤完成 → 最终报告（取最后一步输出）
    const lastStep = snapshot.steps[snapshot.steps.length - 1];
    const lastRunStep = lastStep
      ? await prisma.runStep.findFirst({ where: { runId, stepIndex: lastStep.position } })
      : null;
    const finalReport = lastRunStep?.output
      ? typeof lastRunStep.output === "string"
        ? lastRunStep.output
        : JSON.stringify(lastRunStep.output, null, 2)
      : "（配方无步骤输出，未生成报告）";

    await prisma.run.update({
      where: { id: runId },
      data: { status: "done", finalReport, completedAt: new Date() },
    });
  } catch (e) {
    await prisma.run.update({
      where: { id: runId },
      data: { status: "failed", error: e instanceof Error ? e.message : String(e), completedAt: new Date() },
    });
  }
}
