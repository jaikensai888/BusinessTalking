/* eslint-disable no-restricted-syntax -- 本文件是「token 值的程序化取色源」：hex 必须与
   globals.css @theme 中的 ink 阶梯逐字对应，供 canvas/内联样式计算使用，非绕过 token */
/** 头像/名字标签取色：与 Avatar 共用（保证名字标签与头像是同一中性色）
 *  2026-09-08：原先按名称哈希取 8 色彩虹，违反 DESIGN.md「不引入第二个强调色」。
 *  改为规范中性色阶梯（ink / ink-80 / ink-60 / ink-48）——既保留按名稳定区分，
 *  又不引入任何新色相。最浅一档 #6e6e73 对白字仍满足 WCAG AA（约 5.3:1）。
 *  ⚠ 修改 globals.css 的 ink 阶梯时必须同步此处。 */
const PALETTE = ["#1d1d1f", "#333333", "#48484a", "#6e6e73"] as const;

/** 按名称稳定取一个中性色 */
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
