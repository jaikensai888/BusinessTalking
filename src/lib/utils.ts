import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// These @utility classes set font size, not text color. Keep both when merging.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["display-md", "lead", "tagline", "body", "caption", "fine"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
