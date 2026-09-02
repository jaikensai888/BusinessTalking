import fs from "node:fs";
import path from "node:path";
import type { ImportCandidate } from "./runner";

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "data"]);

/** 递归扫描目录下的 SKILL.md（深度 ≤3） */
export function findSkillFiles(dir: string, depth = 0, maxDepth = 3): string[] {
  if (depth > maxDepth) return [];
  let results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results = results.concat(findSkillFiles(path.join(dir, entry.name), depth + 1, maxDepth));
    } else if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

interface Frontmatter {
  name?: string;
  description?: string;
}

/** 解析 SKILL.md：YAML frontmatter（--- 分隔）+ 正文 */
export function parseSkillFile(filePath: string): { fm: Frontmatter; body: string } {
  const raw = fs.readFileSync(filePath, "utf8");
  const trimmed = raw.replace(/^\uFEFF/, "").trimStart();

  if (trimmed.startsWith("---")) {
    const end = trimmed.indexOf("\n---", 3);
    if (end !== -1) {
      const fmText = trimmed.slice(3, end);
      const body = trimmed.slice(end + 4).trim();
      const fm: Frontmatter = {};
      for (const line of fmText.split("\n")) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
        if (key === "name") fm.name = value;
        if (key === "description") fm.description = value;
      }
      return { fm, body };
    }
  }
  return { fm: {}, body: trimmed };
}

/** 扫描任务目录并产出导入候选 */
export function scanSkillCandidates(dir: string): ImportCandidate[] {
  const sourceRef = "(npx 导入)";
  return findSkillFiles(dir)
    .map((file) => {
      try {
        const { fm, body } = parseSkillFile(file);
        const rel = path.relative(dir, file).split(path.sep).join("/");
        const name = fm.name ?? (path.basename(path.dirname(file)) || "未命名 skill");
        const description = fm.description ?? null;
        const instructions = body.slice(0, 2000);
        if (!instructions) return null;
        return { file: rel, name, description, instructions, sourceRef };
      } catch {
        return null;
      }
    })
    .filter((c): c is ImportCandidate => c !== null);
}
