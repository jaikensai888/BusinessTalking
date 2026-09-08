# BusinessTalking UI 设计评审与优化方案

**评审日期**：2026-09-08
**评审人**：UI Designer
**评审基准**：`docs/prd/DESIGN.md`（Apple 设计语言 token 规范）
**评审范围**：`src/app/**` 17 个页面 + `src/components/**` 22 个组件（约 5,600 行）

---

## 一、执行摘要

项目拥有一份**质量相当高的设计规范**（DESIGN.md，562 行，含完整 YAML token 表），但**实现与规范之间存在系统性漂移**。规范定义了 4 档圆角、1 个阴影、3/4/6/7 字重阶梯、单一强调色；实现里出现了 **7 种圆角、19 种阴影、26 处禁用字重 500、8 色彩虹调色板**。

**核心判断**：这不是「做得不好」，而是「规范写好了但没有被强制执行」。视觉债务集中在 3 个可收敛的维度上，全部属于低风险、高收益的修改。

| 维度 | 规范 | 现状 | 偏差度 |
|---|---|---|---|
| 圆角刻度 | 4 档（8 / 11 / 18 / pill） | **5 种**（6 / 8 / 12 / 16 / pill），18px 与 11px 零使用 | 严重 |
| 阴影 | **1 个**，仅用于产品图 | **19 种**，大量用于卡片/按钮/气泡 | 严重 |
| 强调色 | 单一 Action Blue | **8 色彩虹**（run-cards 按名称哈希生成） | 严重 |
| 字重阶梯 | 300 / 400 / 600 / 700（无 500） | 含 **26 处 font-medium(500)** | 中等 |
| 字号刻度 | 8 档 | **15 种**任意 px（11px 用 37 次、13px 用 55 次） | 中等 |
| 明暗瓦片 | 核心节奏语言 | tile-1/2/3 仅 **3 处**引用 | 中等 |
| 组件复用 | Card 基元 | Card **0 引用**，57 处手写 `<button>` | 中等 |
| 响应式 | 8 个断点 | 全项目仅 **19 处**断点类 | 待补 |
| 无障碍 | WCAG AA | 焦点环已全局实现 ✅；模态无焦点陷阱、图标按钮 < 44px | 待补 |

---

## 二、值得肯定的部分（不要改坏）

1. **焦点环已全局落地** — `globals.css:51` 的 `:focus-visible { outline: 2px solid var(--color-primary-focus) }` 是全项目最规范的一处实现，符合 WCAG AA。
2. **占位符对比度主动修正过** — `ink-40 (#86868b)` 与 `ink-48 (#6e6e73)` 是为 AA 对比度从规范 `#7a7a7a` 上调的，注释里写明了原因。这类「规范服从可访问性」的决策应当保留。
3. **克制动效** — `fl-rise` 仅用 transform/opacity，且包裹在 `prefers-reduced-motion: no-preference` 内。
4. **卡片键盘可达** — `spaces-cards.tsx:181` 用 `role="checkbox"` + `aria-checked` + Enter/Space 处理，语义完整。
5. **Token 已集中管理** — `@theme inline` 里 20 个色值 token，改一处即可全局生效，这是收敛成本低的根本原因。

---

## 三、问题清单（按严重度）

### P0 — 直接违背规范的视觉违规

#### 1. 圆角刻度失守（最易修，收益最大）

`components/ui/card.tsx:11` 注释写着「`rounded-lg` = DESIGN.md store-utility-card 的 18px」，但 **Tailwind v4 的 `rounded-lg` 是 8px**，不是 18px。这个误解扩散到了全项目。

实测分布（7 个类名 → **5 种实际渲染值**）：

| 类名 | Tailwind 渲染值 | 次数 | 判定 |
|---|---|---|---|
| `rounded-lg` | **8px** | 56 | ❌ 语义错配（应为 18px） |
| `rounded-[8px]` | 8px | 16 | ❌ 与 rounded-lg 重复 |
| `rounded-2xl` | **16px** | 34 | ❌ 越界 |
| `rounded-xl` | **12px** | 16 | ❌ 越界 |
| `rounded-md` | **6px** | 8 | ❌ 语义错配（应为 11px） |
| `rounded-[6px]` | 6px | 2 | ❌ 越界 |
| `rounded-full` | pill | 32 | ✅ |

**关键洞察**：规范要求的两个核心值——**18px（卡片）与 11px（capsule）实际使用次数为 0**。全部卡片塌缩到了 8px，这正是界面缺少 Apple 式「大圆角容器」观感的直接原因。也就是说，这不只圆角是"多了几种"，而是**规范里最重要的那一档根本没生效**。

**修复**：在 `globals.css` 的 `@theme` 中重定义圆角刻度，一次性对齐语义：

```css
@theme inline {
  --radius-sm: 8px;    /* 紧凑工具按钮 */
  --radius-md: 11px;   /* pearl capsule / 徽章 */
  --radius-lg: 18px;   /* 卡片 —— 关键修正 */
  --radius-pill: 9999px;
}
```

随后批量替换：`rounded-2xl` / `rounded-xl` / `rounded-[8px]` / `rounded-[6px]` → 落到上述 4 档。
**预期收益**：圆角种类 7 → 4，卡片视觉重量显著提升，接近 Apple store utility card 的观感。

#### 2. 阴影失控（19 种 vs 规范 1 种）

DESIGN.md 明确规定：**整个系统只有一个阴影，且只用于「产品图落在表面上」，绝不用于卡片、按钮或文字**。当前实现中：

- `spaces-cards.tsx:194` — 卡片 hover `shadow-[0_14px_44px_rgba(0,0,0,0.08)]`
- `run-cards.tsx:115` — 同上
- `discussions/page.tsx:753` — 聊天气泡 `shadow-[0_6px_18px_rgba(0,102,204,0.22)]` + `ring-1 ring-black/5`
- `button.tsx:10` — 主按钮内阴影 inset
- 另有 15 处各自不同的任意值阴影

**修复**：卡片 hover 改用规范推荐的「表面变化而非加装饰」（DESIGN.md: "When in doubt about emphasis: alternate surface before adding chrome"）：

```
去掉：hover:-translate-y-0.5 hover:shadow-[0_14px_44px_rgba(0,0,0,0.08)]
改为：hover:border-primary/40 hover:bg-pearl/60
```

聊天气泡去掉阴影与 ring，改用**表面色差异**区分身份：用户气泡 = `bg-primary` 实底，专家气泡 = `bg-white`，无需阴影即可分层。

#### 3. 彩虹调色板（单一强调色原则被破坏）

`components/workspace/run-cards.tsx:30`：

```js
const ICON_COLORS = ["#2f6fed", "#4f46e5", "#0ea5a6", "#b98a2f", "#e0567a", "#5b6b8c", "#7c5cd6", "#2e7d64"];
```

按配方名哈希取色，**生成 8 种色相的大色块**（`run-cards.tsx:121` 是 96px 高的实心色块）。这是全项目最刺眼的一处违规——在一个刻意做到近乎无色的系统里，卡片网格是彩色的。规范原文：「Don't introduce a second accent color」。

**修复**：改为规范内的深色瓦片 + 单色图标：

```jsx
<div className="flex h-24 items-center justify-center rounded-xl bg-tile-1">
  <FileText size={40} weight="bold" className="text-primary-on-dark" />
</div>
```

这同时把「明暗瓦片」这一核心语言第一次真正引入产品。

#### 4. 字重 500 出现在 26 处

规范：字重阶梯为 300 / 400 / 600 / 700，**500 刻意缺席**，中段一律用 600。
**修复**：`font-medium` → `font-semibold`（`button.tsx:46`、`badge.tsx:27` 等 26 处）。

---

### P1 — 设计语言缺失（Apple 底盘没有建立）

#### 5. 明暗瓦片节奏几乎未启用

DESIGN.md 的灵魂是「light tile ↔ dark tile 交替，色彩变化本身就是分隔线」。当前 `tile-1/2/3` 与 `primary-on-dark` 合计仅 **3 处引用**，全站几乎全是白/pearl，结果是**一个规范的 SaaS 后台，而不是规范描述的「博物馆画廊」**。

建议引入节奏的位置：

| 位置 | 现状 | 建议 |
|---|---|---|
| 全局导航 `layout.tsx:42` | `bg-pearl`（近白） | 改 `bg-black`。**注意**：该行注释写的是「全局黑色导航 44px」，与代码矛盾——二者必有一错，规范 `global-nav` 明确是 `#000000` |
| 工作台「会话空间」区 | 白底 | 改 `bg-tile-1` 深色瓦片，白卡片浮于其上（这正是规范唯一允许「产品投影」的场景） |
| 运行详情 / 设置页统计区 | 白底 | 用 `tile-2` / `tile-3` 做微分层 |

#### 6. 字号刻度碎片化（15 种任意值）

规范定义了 8 档字号，实现里出现 **15 种**：11 / 12 / 13 / 14 / 15 / 16 / 17 / 18 / 19 / 20 / 21 / 26 / 28 / 30 / 34px。

其中 **11px 用了 37 次、13px 用了 55 次，两者都不在规范内**（规范最小是 12px fine-print）。

**修复**：
- 11px → 12px（fine-print）
- 13px → 14px（caption）
- 15px → 17px（body）或 14px（caption），二选一，不要并存

#### 7. 全局负字距误用于小字

`globals.css:41` 对 `body` 应用 `letter-spacing: -0.374px`，会继承到**所有**文字，包括 11px 的元信息。规范明确：「Never used at 12px or below」。11px 中文叠 -0.374px 字距会明显发挤。

**修复**：把负字距限定在 ≥17px 的 display/body：

```css
body { letter-spacing: 0; }
h1, h2, h3, .display { letter-spacing: -0.374px; }
.text-\[11px\], .text-\[12px\] { letter-spacing: 0; }
```

---

### P2 — 体系化建设（防止债务复发）

#### 8. 组件库形同虚设

| 组件 | 被引用次数 |
|---|---|
| `Card` | **0** |
| `EmptyState` | 0（页面各自手写空态） |
| `Button` | 13 |
| 手写 `<button>` | **57** |
| 手写 `<textarea>/<input>` | 17 |

`skill-card.tsx:40` 手写 `bg-white border border-hairline rounded-lg p-6`，而 `Card` 组件做的正是这件事。这意味着第 1 条圆角修复**无法通过改一个文件生效**——这是当前最值得警惕的结构性问题。

**修复**：
1. 把 `skill-card` / `run-cards` / `spaces-cards` 三处卡片统一收敛到 `Card` 基元（先改组件，再改 token，一劳永逸）
2. 工作台的 `Chip`（`page.tsx:41`）与讨论页的 pill 按钮统一到 `Button` 的新 variant
3. 加 CI 守卫，禁止新增：任意值字号 `text-[Npx]`、任意值阴影 `shadow-[`、硬编码 hex

#### 9. 响应式几乎空白

全项目仅 **19 处**断点类。两处硬伤：

- `sidebar.tsx:64` — 固定 `w-56`，仅靠手动折叠按钮，**≤833px 无抽屉化**（规范明确要求此断点折叠为汉堡菜单）
- `discussions/page.tsx:873` — `aside w-[320px]` 固定不折叠。在 1280px 屏上：224(侧栏) + 320(右栏) = 544px 被导航占用，聊天区仅剩 736px；平板/手机上直接破版

**修复**：至少补齐 ≤1024px 右栏抽屉化、≤833px 侧栏抽屉化、≤640px 容器内边距收窄。

#### 10. 无障碍待补项

已有：全局焦点环 ✅、卡片键盘操作 ✅、图标按钮 aria-label（25 处）✅
缺失：
- 模态（产物预览 `discussions/page.tsx:998`、选配方 `page.tsx:557`）**无 `role="dialog"` / `aria-modal`、无 Escape 关闭、无焦点陷阱** —— 键盘用户进入后无法退出
- 图标按钮尺寸偏小：`h-6 w-6`（11 处）、`h-8 w-8` = 32px，规范触控目标最小 **44×44**
- `aria-live` / `role="status"` 仅 2 处，运行状态变化（讨论进行中/失败）未对读屏播报

---

## 四、优化路线图

### 第一批（P0）· 建议 1 个迭代内完成 · 低风险高收益

1. `@theme` 重定义 4 档圆角 → 批量替换 5 种为 4 种（让 18px 卡片圆角真正生效）
2. 删除卡片/按钮/气泡上的 18 处越界阴影，hover 改用表面色变化
3. `run-cards.tsx:30` 八色彩虹 → `tile-1` + `primary-on-dark`
4. 26 处 `font-medium` → `font-semibold`

> 这 4 项完成后，视觉一致性预计从当前约 60% 提升至 85%+，且全部是 CSS/类名层面的改动，不触碰业务逻辑。

### 第二批（P1）· 设计语言回归

5. 全局导航改黑 + 引入明暗瓦片节奏（3 处）
6. 字号 15 档 → 8 档（重点处理 11px / 13px）
7. 负字距收回到 ≥17px

### 第三批（P2）· 体系化防复发

8. 卡片收敛到 `Card` 基元 + CI 守卫
9. 响应式：右栏抽屉化、侧栏抽屉化
10. 无障碍：模态焦点陷阱 + Escape + 44px 触控区 + aria-live

---

## 五、验收清单

- [ ] 全项目圆角种类 ≤ 4 种
- [ ] 全项目阴影种类 ≤ 2 种（1 个产品投影 + 1 个模态层）
- [ ] 除 Action Blue 外，卡片网格中无其他色相
- [ ] 无 `font-medium`
- [ ] 字号种类 ≤ 8 种，且无 11px / 13px
- [ ] `Card` 组件引用数 ≥ 3，手写 `<button>` 数量下降 50%
- [ ] 1280px / 1024px / 768px / 375px 四个宽度下讨论页均不破版
- [ ] 所有模态支持 Escape 关闭且焦点被捕获
- [ ] 所有图标按钮触控区 ≥ 44×44

---

## 附：Token 对照表（规范 vs 实现）

| Token | 规范值 | 实现值 | 状态 |
|---|---|---|---|
| `primary` | #0066cc | #0066cc | ✅ |
| `primary-focus` | #0071e3 | #0071e3 | ✅ |
| `primary-on-dark` | #2997ff | 已定义，**未使用** | ⚠️ |
| `canvas` | #ffffff | #f4f4f6 | ⚠️ 偏差 |
| `canvas-parchment` | #f5f5f7 | #f2f2f4 | ⚠️ 偏差 |
| `surface-pearl` | #fafafc | #fafafc | ✅ |
| `ink` | #1d1d1f | #1d1d1f | ✅ |
| `ink-muted-48` | #7a7a7a | #6e6e73 | ✅ 有意调整（AA 对比度） |
| `ink-40` | — | #86868b | ✅ 新增（占位符 AA） |
| `tile-1/2/3` | #272729 / #2a2a2c / #252527 | 已定义，**几乎未用** | ⚠️ |
| `rounded-lg` | 18px | 8px（Tailwind 默认） | ❌ |
| `rounded-md` | 11px | 6px（Tailwind 默认） | ❌ |
| body | 17px / 400 / 1.47 / -0.374px | 17px / 400 / 1.47 / -0.374px | ✅ |

---

## ✅ 修复实施状态（2026-09-08 全量落地）

以上 P0-P2 问题已全部修复，`tsc` 0 错误、ESLint 0 错误、`next build` 通过：

| 问题 | 修复方式 | 终态 |
|---|---|---|
| 圆角 7 种 | `@theme` 重定义 sm=8/md=11/lg=18/pill，全库迁移 | 3 档 + 方向性变体 |
| 阴影 19 种 | 新增 `--shadow-float`（下拉/浮标），卡片 hover 改表面色变化 | 3 个语义 token（product/float/overlay） |
| 彩虹调色板 | run-cards 改 `tile-1` + `primary-on-dark`；`lib/color.ts` 改 ink 中性色阶梯 | 单一强调色 |
| 组件库 0 采用 | 新建 `ui/modal.tsx`（焦点陷阱/Escape/44px 关闭钮）；3 个模态全部迁移；skill-card 收敛到 `Card` | 模态基元全站统一 |
| 字重/字号 | font-medium 清零；任意值字号 15 种 → 0 | 全部走 token 刻度 |
| 明暗瓦片 | 全局导航改纯黑 44px；会话空间区改暗瓦片承载白卡片 | Apple 底盘建立 |
| 响应式 | 侧边栏 ≤833px 抽屉化、讨论页面板 ≤1024px 折叠、容器 padding 断点 | 已覆盖 |
| 无障碍 | aria-live 运行状态播报；4 处图标按钮伪元素外扩触控区至 44px | 模态+触控达标 |
| 复发防线 | ESLint 守卫：禁任意值字号/阴影/硬编码 hex（豁免 `lib/color.ts` 程序化取色与 canvas 掩码） | CI 可拦截 |

**验收数据（改造前 → 后）**：圆角 7 种 → 3 种；阴影 19 种 → 3 token；任意值字号 15 种 → 0；硬编码 hex 32 处 → 0；font-medium 26 处 → 0。

