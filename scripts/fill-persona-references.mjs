/** 全量补齐人物 skill：从 nuwa-skill 复制完整 SKILL.md + references/research 到 skill/personas/<slug>/ */
import fs from "node:fs";
import path from "node:path";

const NUWA = "G:/claude_project/code-agent/_nuwa/examples";
const DEST = path.join(process.cwd(), "skill", "personas");

const MAP = {
  munger: "munger-perspective",
  naval: "naval-perspective",
  "paul-graham": "paul-graham-perspective",
  "elon-musk": "elon-musk-perspective",
  taleb: "taleb-perspective",
  karpathy: "andrej-karpathy-perspective",
  feynman: "feynman-perspective",
  ilya: "ilya-sutskever-perspective",
  mrbeast: "mrbeast-perspective",
  "sun-yuchen": "sun-yuchen-perspective",
  trump: "trump-perspective",
  "x-mentor": "x-mastery-mentor",
  "zhang-yiming": "zhang-yiming-perspective",
  zhangxuefeng: "zhangxuefeng-perspective",
};
// steve-jobs 已用独立 steve-jobs-skill 完整填充，跳过

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) n += copyDir(s, d);
    else if (e.isFile()) { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

let totalFiles = 0;
for (const [slug, dir] of Object.entries(MAP)) {
  const srcDir = path.join(NUWA, dir);
  if (!fs.existsSync(srcDir)) { console.log(`SKIP ${slug}: ${dir} not found`); continue; }
  const dstDir = path.join(DEST, slug);
  fs.mkdirSync(dstDir, { recursive: true });
  // 覆盖 SKILL.md
  fs.copyFileSync(path.join(srcDir, "SKILL.md"), path.join(dstDir, "SKILL.md"));
  // 复制 references/ + research/
  let n = copyDir(path.join(srcDir, "references"), path.join(dstDir, "references"));
  n += copyDir(path.join(srcDir, "research"), path.join(dstDir, "research"));
  totalFiles += n + 1;
  console.log(`${slug}: SKILL.md + ${n} refs (${dir})`);
}
console.log(`\nDone. total files copied: ${totalFiles}`);
