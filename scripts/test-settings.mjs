/** 测试双 provider 设置：GET/PUT + 多模型 + 测试连接（无有效 Key 验证 DeepSeek 可达性） */
const BASE = "http://localhost:3001/api/v1";

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function main() {
  // 1. GET 旧数据归一化
  const g0 = await api("GET", "/settings");
  console.log("GET(旧):", g0.json?.code === 0, JSON.stringify(g0.json?.data?.llm));

  // 2. PUT openai + DeepSeek baseUrl + 多模型
  const put = await api("PUT", "/settings", {
    provider: "openai",
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-test-1234567890",
    models: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash-vision-exp"],
    defaultModel: "deepseek-v4-flash",
    timeoutSeconds: 120,
  });
  console.log("PUT:", put.json?.code === 0, JSON.stringify(put.json));

  // 3. GET 验证
  const g1 = await api("GET", "/settings");
  const l = g1.json?.data?.llm;
  console.log("GET(新):", g1.json?.code === 0 && l.provider === "openai" && l.models.length === 3 && l.defaultModel === "deepseek-v4-flash" && l.baseUrl === "https://api.deepseek.com", JSON.stringify(l));

  // 4. 非法 provider
  const bad = await api("PUT", "/settings", { provider: "deepseek" });
  console.log("BAD provider:", bad.status === 400 && bad.json?.code === 40001, JSON.stringify(bad.json));

  // 5. 测试连接（无有效 Key → 502，但说明 DeepSeek 请求已发出）
  const t = await api("POST", "/settings/test");
  console.log("TEST(无效Key):", t.status === 502 && t.json?.code === 50201, t.json?.message?.slice(0, 60));
}

main().catch((e) => { console.error(e); process.exit(1); });
