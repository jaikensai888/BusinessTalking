import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { avatarColor } from "@/lib/color";

describe("semantic typography", () => {
  it("preserves foreground colors alongside every custom font size in either order", () => {
    for (const size of ["display-md", "lead", "tagline", "body", "caption", "fine"]) {
      expect(cn("text-white", `text-${size}`)).toContain("text-white");
      expect(cn(`text-${size}`, "text-primary")).toContain(`text-${size}`);
      expect(cn(`text-${size}`, "text-sm")).not.toContain(`text-${size}`);
    }
  });
  it("renders white avatar initials at every size, including inside a colored menu item", () => {
    for (const size of ["sm", "md", "lg", "xl"] as const) {
      const html = renderToStaticMarkup(<div className="text-primary"><Avatar name="张一鸣" size={size} /></div>);
      expect(html).toContain("text-white");
    }
  });
  it("keeps all avatar palette colors at AA contrast against white initials", () => {
    for (const name of ["a", "b", "c", "d"]) {
      const [r, g, b] = avatarColor(name).slice(1).match(/../g)!.map((hex) => parseInt(hex, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      expect(1.05 / (0.05 + 0.2126 * r + 0.7152 * g + 0.0722 * b)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
