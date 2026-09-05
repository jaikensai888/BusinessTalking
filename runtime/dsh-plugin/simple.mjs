// Minimal plugin: no DSH imports, only fs markers. Isolates whether relative-path
// plugin loading works in the project (pnpm) runtime, vs a dependency import issue.
import fs from "node:fs";
const ROOT = "G:/claude_project/code-agent/business-talking/data/dsh";
try {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(`${ROOT}/simple-loaded.marker`, `module loaded at ${Date.now()}\n`);
} catch {}
export function apply(ctx) {
  try {
    fs.writeFileSync(`${ROOT}/simple-applied.marker`, `apply at ${Date.now()} ctx=${!!ctx}\n`);
  } catch {}
}
