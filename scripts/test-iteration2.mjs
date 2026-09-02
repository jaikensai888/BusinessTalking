/**
 * 迭代 2 测试脚本：Skill CRUD + npx 导入（HTTP 实测）
 * 依赖：dev server 运行于 http://localhost:3001
 */
const BASE = "http://localhost:3001/api/v1";

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, pass: !!cond, detail });
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

async function waitForJob(jobId, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { json } = await api("GET", `/skills/import/${jobId}`);
    if (json?.data?.status !== "running") return json?.data ?? null;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

async function main() {
  // ---------- T2-TEST-01 CRUD ----------
  const list = await api("GET", "/skills");
  const items = list.json?.data?.items ?? [];
  check("TC-01 列表返回种子 8 条内置", list.json?.code === 0 && items.length >= 8 && items.every((i) => i.isBuiltin), `count=${items.length}`);

  const search = await api("GET", "/skills?search=财务");
  check("TC-02 搜索过滤(财务)", search.json?.code === 0 && search.json.data.items.every((i) => (i.name + (i.description ?? "")).includes("财务")), `count=${search.json?.data?.items?.length}`);

  const byCat = await api("GET", "/skills?category=战略");
  check("TC-03 分类过滤(战略)", byCat.json?.code === 0 && byCat.json.data.items.length > 0 && byCat.json.data.items.every((i) => i.category === "战略"), `count=${byCat.json?.data?.items?.length}`);

  const create = await api("POST", "/skills", {
    name: "测试技能 A",
    description: "迭代2测试",
    category: "通用",
    instructions: "你是测试技能。",
    tags: ["测试"],
  });
  const createdId = create.json?.data?.id;
  check("TC-04 创建成功", create.json?.code === 0 && !!createdId, createdId);

  const createBad = await api("POST", "/skills", { description: "缺 name" });
  check("TC-05 创建缺 name → 40001", createBad.status === 400 && createBad.json?.code === 40001);

  const builtinId = items[0]?.id;
  const delBuiltin = await api("DELETE", `/skills/${builtinId}`);
  check("TC-06 删除内置 → 40901", delBuiltin.status === 409 && delBuiltin.json?.code === 40901);

  const putBuiltin = await api("PUT", `/skills/${builtinId}`, { name: "改名", instructions: "x" });
  check("TC-08 更新内置 → 40901", putBuiltin.status === 409 && putBuiltin.json?.code === 40901);

  const delCreated = await api("DELETE", `/skills/${createdId}`);
  check("TC-07 删除自建成功", delCreated.json?.code === 0);

  // ---------- T2-TEST-02 npx 导入 ----------
  const bad1 = await api("POST", "/skills/import/npx", { command: "echo hi" });
  check("S1 非法命令(非 npx) → 40001", bad1.status === 400 && bad1.json?.code === 40001);

  const bad2 = await api("POST", "/skills/import/npx", { command: "npx x; rm -rf /" });
  check("S2 危险符号 → 40001", bad2.status === 400 && bad2.json?.code === 40001);

  const run = await api("POST", "/skills/import/npx", { command: "npx --yes cowsay hello" });
  const jobId = run.json?.data?.jobId;
  check("S3 启动真实 npx 命令", run.json?.code === 0 && !!jobId, jobId ?? "");

  const done = await waitForJob(jobId);
  check("S3b 任务执行完成", done?.status === "done", `status=${done?.status} exit=${done?.exitCode}`);
  check("S3c 日志有内容", (done?.logs?.length ?? 0) > 0, `lines=${done?.logs?.length}`);

  // 写入 SKILL.md 夹具到任务目录，验证解析链路
  const fs = await import("node:fs");
  const path = await import("node:path");
  const jobDir = path.join(process.cwd(), "data", "imports", jobId);
  const fixtureDir = path.join(jobDir, "fixture-skill");
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(
    path.join(fixtureDir, "SKILL.md"),
    "---\nname: 夹具技能\n---\n你是夹具技能，用于测试解析。",
    "utf8"
  );

  const after = await api("GET", `/skills/import/${jobId}`);
  const candidates = after.json?.data?.candidates ?? [];
  check("S4 解析出 SKILL.md 候选", candidates.length >= 1 && candidates.some((c) => c.name === "夹具技能"), `candidates=${JSON.stringify(candidates.map((c) => c.name))}`);

  const target = candidates.find((c) => c.name === "夹具技能");
  const confirm = await api("POST", `/skills/import/${jobId}/confirm`, { selectedFiles: [target.file] });
  check("S5 确认入库", confirm.json?.code === 0 && confirm.json?.data?.imported?.length === 1);

  const importedList = await api("GET", "/skills?search=夹具技能");
  const imported = importedList.json?.data?.items?.find((i) => i.name === "夹具技能");
  check("S5b 入库 source=npx", !!imported && imported.source === "npx" && imported.sourceRef?.includes("npx"), `source=${imported?.source}`);

  // 清理夹具
  await api("DELETE", `/skills/${imported?.id}`);

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
