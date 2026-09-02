/**
 * 迭代 3/4/5 集成测试：人格/对话、配方编排、执行引擎（HTTP 实测）
 * 依赖：dev server 运行于 http://localhost:3001
 * 说明：无有效 LLM Key 时验证失败路径与状态机；有效 Key 的成功闭环由用户补充验证
 */
const BASE = "http://localhost:3001/api/v1";

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitRun(id, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { json } = await api("GET", `/runs/${id}`);
    if (json?.data && json.data.status !== "running" && json.data.status !== "pending") return json.data;
    await sleep(2000);
  }
  return null;
}

async function main() {
  // ============ 迭代 3：人格与对话 ============
  const list = await api("GET", "/personas");
  const personas = list.json?.data?.items ?? [];
  check("P1 personas 列表含 6 内置", list.json?.code === 0 && personas.length >= 6 && personas.every((p) => p.isBuiltin), `count=${personas.length}`);

  const inv = await api("GET", "/personas?perspectiveType=investor");
  check("P2 视角筛选 investor", inv.json?.code === 0 && inv.json.data.items.length === 1 && inv.json.data.items[0].name === "风险投资人");

  const create = await api("POST", "/personas", { name: "测试人格", systemPrompt: "你是测试人格。", perspectiveType: "custom", tags: ["测试"] });
  const pid = create.json?.data?.id;
  check("P3a 创建人格", create.json?.code === 0 && !!pid);

  const upd = await api("PUT", `/personas/${pid}`, { name: "测试人格改", systemPrompt: "你是测试人格改。", perspectiveType: "analyst" });
  check("P3b 更新人格", upd.json?.code === 0);

  const delBuiltin = await api("DELETE", `/personas/${personas[0].id}`);
  check("P4 删除内置人格 → 409", delBuiltin.status === 409 && delBuiltin.json?.code === 40901);

  const chatNoKey = await api("POST", `/personas/${personas[0].id}/chat`, { message: "你好" });
  check("P5 对话（无效 Key）→ 50201 可读错误", chatNoKey.status === 502 && chatNoKey.json?.code === 50201);

  const convs = await api("GET", "/conversations");
  check("P6 对话失败已回滚（无孤立会话）", convs.json?.code === 0 && convs.json.data.items.length === 0, `count=${convs.json?.data?.items?.length}`);

  const delPersona = await api("DELETE", `/personas/${pid}`);
  check("P3c 删除自建人格", delPersona.json?.code === 0);

  // ============ 迭代 4：配方编排 ============
  const skills = (await api("GET", "/skills?page_size=100")).json?.data?.items ?? [];
  const s1 = skills.find((s) => s.name === "目标清晰化");
  const s2 = skills.find((s) => s.name === "商业模式诊断");
  const pInv = personas.find((p) => p.name === "风险投资人");

  const rc = await api("POST", "/recipes", {
    name: "测试配方",
    steps: [
      { skillId: s1.id },
      { skillId: s2.id, personaId: pInv.id },
    ],
  });
  const rid = rc.json?.data?.id;
  check("R1 创建配方（含步骤）", rc.json?.code === 0 && !!rid, rid ?? "");

  const rd = await api("GET", `/recipes/${rid}`);
  check("R2 详情含步骤与名称", rd.json?.code === 0 && rd.json.data.steps.length === 2 && rd.json.data.steps[1].skill.name === "商业模式诊断" && rd.json.data.steps[1].persona?.name === "风险投资人");

  const ru = await api("PUT", `/recipes/${rid}`, { name: "测试配方改", steps: [{ skillId: s1.id }] });
  check("R3 更新配方（步骤替换+版本递增）", ru.json?.code === 0 && ru.json.data.version === "1.1");

  const rdup = await api("POST", `/recipes/${rid}/duplicate`);
  check("R4 复制配方", rdup.json?.code === 0 && rdup.json.data.name.includes("副本"));
  const dupId = rdup.json?.data?.id;

  const badStep = await api("POST", "/recipes", { name: "坏配方", steps: [{ skillId: "not-exist" }] });
  check("R6 引用不存在 skill → 40001", badStep.status === 400 && badStep.json?.code === 40001);

  // 引用保护：创建自建 skill → 配方引用 → 删除 skill 被拦截
  const ms = await api("POST", "/skills", { name: "被引用技能", instructions: "x" });
  const msId = ms.json?.data?.id;
  await api("POST", "/recipes", { name: "引用配方", steps: [{ skillId: msId }] });
  const delRef = await api("DELETE", `/skills/${msId}`);
  check("R7 删除被引用 skill → 409", delRef.status === 409 && delRef.json?.code === 40901);

  const rdel = await api("DELETE", `/recipes/${rid}`);
  check("R5 删除配方", rdel.json?.code === 0);
  await api("DELETE", `/recipes/${dupId}`);

  // ============ 迭代 5：执行引擎 ============
  const r5 = await api("POST", "/recipes", {
    name: "引擎测试配方",
    steps: [{ skillId: s1.id }, { skillId: s2.id }],
  });
  const r5id = r5.json?.data?.id;

  const start = await api("POST", "/runs", { recipeId: r5id, ideaInput: "测试商业想法" });
  const runId = start.json?.data?.id;
  check("U1 启动运行", start.json?.code === 0 && !!runId, runId ?? "");

  const run = await waitRun(runId);
  check("U2 无有效 Key → 运行失败且步骤带错误", run?.status === "failed" && run.steps?.some((s) => s.status === "failed" && s.error), `status=${run?.status} step=${run?.steps?.[0]?.status}`);

  const detail = await api("GET", `/runs/${runId}`);
  check("U3 详情含步骤与错误信息", detail.json?.code === 0 && detail.json.data.steps.length === 2 && !!detail.json.data.error);

  const hist = await api("GET", "/runs?status=failed");
  check("U4 历史筛选 failed", hist.json?.code === 0 && hist.json.data.items.some((i) => i.id === runId));

  const retry = await api("POST", `/runs/${runId}/steps/1/retry`);
  check("U5 重试失败步骤 → running", retry.json?.code === 0 && retry.json.data.status === "running");
  await sleep(3000);

  const skip1 = await api("POST", `/runs/${runId}/steps/1/skip`);
  check("U6a 跳过步骤1", skip1.json?.code === 0);
  const runAfterSkip = await waitRun(runId);
  // 步骤2也会因无效 Key 失败 → 再跳过
  if (runAfterSkip?.status === "failed") {
    await api("POST", `/runs/${runId}/steps/2/skip`);
  }
  const runDone = await waitRun(runId);
  check("U6b 全部跳过 → 运行完成", runDone?.status === "done" && !!runDone.finalReport);

  const badRun = await api("POST", "/runs", { recipeId: "not-exist", ideaInput: "x" });
  check("U7 配方不存在 → 404", badRun.status === 404 && badRun.json?.code === 40401);

  // 清理
  await api("DELETE", `/recipes/${r5id}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n==== 结果：${results.length - failed.length}/${results.length} 通过 ====`);
  if (failed.length > 0) {
    console.log("失败项：", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
