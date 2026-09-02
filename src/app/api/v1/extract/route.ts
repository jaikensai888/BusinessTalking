import { err, ok } from "@/lib/api";
import { extractText, getDocumentProxy } from "unpdf";

const MAX_CHARS = 12000;
const TEXT_EXTS = ["txt", "md", "markdown", "csv", "json"];

/** POST /api/v1/extract — 上传文件（pdf/txt 等），提取文本用于分析沟通 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err(40001, "请上传文件（multipart/form-data）", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return err(40001, "缺少 file 字段", 400);

  const name = file.name || "upload";
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());

  let text = "";
  try {
    if (ext === "pdf") {
      const pdf = await getDocumentProxy(buf);
      const res = await extractText(pdf, { mergePages: true });
      text = res.text;
    } else if (TEXT_EXTS.includes(ext)) {
      text = new TextDecoder("utf-8").decode(buf);
    } else {
      return err(40001, "暂不支持该格式（支持 pdf / txt / md / csv / json）", 400);
    }
  } catch (e) {
    return err(40001, `解析文件失败：${e instanceof Error ? e.message : String(e)}`, 400);
  }

  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const truncated = text.length > MAX_CHARS;
  if (truncated) text = text.slice(0, MAX_CHARS);

  return ok({ filename: name, text, charCount: text.length, truncated });
}
