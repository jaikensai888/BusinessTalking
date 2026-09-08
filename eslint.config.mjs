import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * 设计系统 CI 守卫（docs/prd/DESIGN.md）
 * 禁止绕过 token 的写法，防止规范再次漂移：
 *  - 任意值字号 text-[Npx]：字号只允许 @theme 定义的 8 档刻度
 *  - 任意值阴影 shadow-[...]：全系统仅 --shadow-product / --shadow-overlay
 *  - 硬编码 hex 色值：颜色必须走 CSS 变量 / Tailwind token
 */
const designSystemGuards = {
  files: ["src/**/*.tsx", "src/**/*.ts"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "Literal[value=/\\btext-\\[\\d+px\\]/]",
        message:
          "DESIGN.md：禁止任意值字号 text-[Npx]。请使用规范 8 档刻度（text-hero/title/body/caption/fine/tagline 等 @theme token）。",
      },
      {
        selector: "Literal[value=/\\bshadow-\\[/]",
        message:
          "DESIGN.md：禁止任意值阴影 shadow-[...]。仅允许 shadow-product（产品投影）与 shadow-overlay（模态层）。",
      },
      {
        selector:
          "JSXAttribute[name.name=/^style$/] > JSXExpressionContainer > ObjectExpression > Property[key.name=/^(color|backgroundColor|borderColor|background)$/][value.type='Literal']",
        message:
          "DESIGN.md：禁止内联硬编码颜色。请使用 CSS 变量 / Tailwind token（bg-primary、text-ink-48 等）。",
      },
      {
        selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
        message:
          "DESIGN.md：禁止硬编码 hex 色值。请使用 @theme 中的颜色 token（primary、ink、pearl、tile-1 等）。",
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  designSystemGuards,
]);

export default eslintConfig;
