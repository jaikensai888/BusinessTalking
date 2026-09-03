import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";

export interface ReportInput {
  id: string;
  brief: string;
  rounds: number;
  personas: { name: string; perspectiveType: string }[];
  messages: { role: string; sender: string; content: string; turn: number }[];
  summary: string;
}

/** 把简要用作文件名安全片段 */
function slugify(s: string): string {
  const slug = s
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|#%&+\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "discussion";
}

/** 组装讨论报告 MD：综合建议 + 专家观点摘录 + 讨论全文 */
export function buildReportMd(input: ReportInput): string {
  const { brief, rounds, personas, messages, summary } = input;
  const date = new Date().toLocaleString("zh-CN", { hour12: false });
  const L: string[] = [];

  L.push(`# 多人讨论报告：${brief}`);
  L.push("");
  L.push(
    `> 参与专家：${personas.length ? personas.map((p) => `${p.name}`).join("、") : "—"}　｜　轮数：${rounds}　｜　生成时间：${date}`
  );
  L.push("");

  // 综合建议
  L.push("## 一、综合建议");
  L.push("");
  L.push(summary || "（未生成）");
  L.push("");

  // 专家观点摘录
  L.push("## 二、专家观点摘录");
  L.push("");
  const personaMsgs = messages.filter((m) => m.role === "persona");
  if (personaMsgs.length) {
    const seen = new Set<string>();
    for (const m of personaMsgs) {
      const key = `${m.sender}|${m.turn}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const snippet = m.content.replace(/\s+/g, " ").trim().slice(0, 160);
      L.push(`- **${m.sender}**（第 ${m.turn} 轮）：${snippet}`);
    }
  } else {
    L.push("（暂无）");
  }
  L.push("");

  // 讨论全文
  L.push("## 三、讨论全文");
  L.push("");
  let lastTurn = 0;
  for (const m of messages) {
    if (m.role === "skill") continue; // 人格设定/参考资料为内部消息，不进报告
    if (m.role === "user") {
      L.push("### 我的插话");
      L.push("");
      L.push(`**我**：${m.content}`);
      L.push("");
      continue;
    }
    if (m.role === "summary") continue; // 建议已单列在首部
    if (m.turn !== lastTurn) {
      if (lastTurn) L.push("");
      L.push(`### 第 ${m.turn} 轮`);
      lastTurn = m.turn;
    }
    L.push(`**${m.sender}**：${m.content}`);
    L.push("");
  }

  return L.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

/** 保存报告：写盘（data/reports/）+ 入库为讨论产物，返回产物元数据 */
export async function saveReport(input: ReportInput): Promise<{ id: string; filePath: string; title: string; summary: string }> {
  const md = buildReportMd(input);

  const dir = path.join(process.cwd(), "data", "reports");
  fs.mkdirSync(dir, { recursive: true });
  const filename = `discussion-${input.id}-${slugify(input.brief)}.md`;
  const relPath = `${path.join("data", "reports", filename).split(path.sep).join("/")}`;
  fs.writeFileSync(path.join(process.cwd(), relPath), md, "utf8");

  const title = `多人讨论报告：${input.brief.slice(0, 30)}`;
  const summary = input.summary.replace(/\s+/g, " ").trim().slice(0, 80);

  const artifact = await prisma.discussionArtifact.create({
    data: {
      discussionId: input.id,
      title,
      type: "report",
      filePath: relPath,
      summary,
      content: md,
    },
  });

  return { id: artifact.id, filePath: relPath, title, summary };
}
