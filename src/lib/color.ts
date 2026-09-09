/* eslint-disable no-restricted-syntax -- 本文件是「强调色阶梯的程序化取色源」：hex 与
   globals.css @theme 的 primary 家族对齐，供内联样式计算使用，非绕过 token */
/** 头像/名字标签取色：与 Avatar 共用（保证名字标签与头像是同一颜色）
 *  2026-09-08（二次修订）：第一版改成 ink 中性色阶梯后所有头像近似黑块，
 *  视觉观感差；改为 primary（品牌蓝）明度阶梯——仍是单一强调色、不引入
 *  第二色相，但头像之间有可感知的深浅区分。四档对白字均 ≥4.5:1（WCAG AA）。
 *  ⚠ 修改 globals.css 的 primary 色值时评估同步此处。 */
const PALETTE = ["#0a4d8c", "#0d66c2", "#0876da", "#0059b3"] as const;

/** 按名称稳定取一个强调色 */
export function avatarColor(name: string): string {
  const hue = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return PALETTE[hue % PALETTE.length];
}

/** 把 hex 与白色混合：ratio 为保留原色的比例（1=原色，越小越浅） */
export function tint(hex: string, ratio: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const tr = Math.round(r * ratio + 255 * (1 - ratio));
  const tg = Math.round(g * ratio + 255 * (1 - ratio));
  const tb = Math.round(b * ratio + 255 * (1 - ratio));
  return `rgb(${tr}, ${tg}, ${tb})`;
}
