/** 与 Avatar 一致的按名称取色板（保证名字标签/气泡与头像同色系） */
const PALETTE = ["#2f6fed", "#4f46e5", "#0ea5a6", "#b98a2f", "#e0567a", "#5b6b8c", "#7c5cd6", "#2e7d64"] as const;

/** 按名称稳定取一个主题色 */
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
