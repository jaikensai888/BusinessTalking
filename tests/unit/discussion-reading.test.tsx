import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "@/components/ui/markdown";

describe("discussion rich text", () => {
  it("keeps numbered lists ordered", () => {
    const html = renderToStaticMarkup(<Markdown>{"1. First\n2. Second"}</Markdown>);
    expect(html).toContain("<ol");
  });
  it("renders comparison tables and fenced code", () => {
    const html = renderToStaticMarkup(<Markdown>{"| Item | Value |\n| --- | --- |\n| A | B |\n\n```js\nconst x = 1;\n```"}</Markdown>);
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<pre");
    expect(html).not.toContain("```js");
  });
});
