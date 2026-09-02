import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BusinessTalking",
  description: "商业可行性分析工作台：收录 skill 与人格，编排配方，产出带多视角质询的可行性报告",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
