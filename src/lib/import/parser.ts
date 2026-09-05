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
  version?: string;
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
        if (key === "version") fm.version = value;
      }
      return { fm, body };
    }
  }
  return { fm: {}, body: trimmed };
}

/** 列出 SKILL.md 目录下的资源文件（references/、examples/ 下 .md） */
export function listSkillResources(skillMdPath: string): string[] {
  const baseDir = path.dirname(skillMdPath);
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const childRel = path.join(rel, e.name).split(path.sep).join("/");
      if (e.isDirectory()) {
        walk(full, childRel);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        out.push(childRel);
      }
    }
  };
  walk(path.join(baseDir, "references"), "references");
  walk(path.join(baseDir, "examples"), "examples");
  return out;
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
        const version = fm.version ?? null;
        // 不再截断正文，保留完整 SKILL.md 供不可变安装
        if (!body) return null;
        const resources = listSkillResources(file);
        const abs = path.resolve(dir, file);
        const readResource = (r: string) => {
          const base = path.dirname(abs);
          const target = path.resolve(base, r);
          // 防目录穿越：必须落在 SKILL.md 所在目录内
          if (!target.startsWith(base)) return null;
          try {
            return fs.readFileSync(target, "utf8");
          } catch {
            return null;
          }
        };
        return { file: rel, name, description, version, content: body, resources, sourceRef, readResource };
      } catch {
        return null;
      }
    })
    .filter((c): c is Exclude<typeof c, null> => c !== null);
}
