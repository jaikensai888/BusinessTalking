import fs from "node:fs";
import path from "node:path";

/** 读取人物 skill（SKILL.md）内容 */
export function readSkillMd(skillPath: string | null | undefined): string | null {
  if (!skillPath) return null;
  try {
    return fs.readFileSync(path.join(process.cwd(), skillPath), "utf8");
  } catch {
    return null;
  }
}

/** 列出人物 skill 目录下的参考文档（references/ + examples/ 中的 .md，不含 SKILL.md） */
export function listReferences(skillPath: string | null | undefined): { name: string; rel: string }[] {
  if (!skillPath) return [];
  const base = path.resolve(process.cwd(), path.dirname(skillPath));
  const out: { name: string; rel: string }[] = [];

  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const childRel = path.join(rel, e.name);
      if (e.isDirectory()) {
        walk(full, childRel);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md") && e.name.toLowerCase() !== "skill.md") {
        out.push({ name: e.name, rel: path.join(rel, e.name).split(path.sep).join("/") });
      }
    }
  };

  walk(path.join(base, "references"), "references");
  walk(path.join(base, "examples"), "examples");
  return out;
}

/** 读取某个参考文档内容（限定在 skill 目录内，防目录穿越） */
export function readRef(skillPath: string | null | undefined, refRel: string): string | null {
  if (!skillPath) return null;
  const base = path.resolve(process.cwd(), path.dirname(skillPath));
  const full = path.resolve(base, refRel);
  if (!full.startsWith(base)) return null;
  try {
    return fs.readFileSync(full, "utf8");
  } catch {
    return null;
  }
}
