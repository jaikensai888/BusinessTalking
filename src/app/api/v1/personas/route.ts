import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import type { PerspectiveType } from "@prisma/client";

/** GET /api/v1/personas — 列表（search/perspectiveType/page） */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() ?? "";
  const perspectiveType = searchParams.get("perspectiveType")?.trim() || undefined;
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("page_size") ?? 20) || 20));

  const where = {
    ...(perspectiveType ? { perspectiveType: perspectiveType as PerspectiveType } : {}),
    ...(search ? { OR: [{ name: { contains: search } }, { description: { contains: search } }] } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.persona.count({ where }),
    prisma.persona.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        description: true,
        perspectiveType: true,
        avatarType: true,
        avatarValue: true,
        isBuiltin: true,
        tags: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return ok({
    items,
    pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
  });
}

const ALLOWED_TYPES = ["investor", "customer", "competitor", "economist", "entrepreneur", "analyst", "custom"];

/** POST /api/v1/personas — 新增人格 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
  if (!name || name.length > 100) return err(40001, "name 必填且不超过 100 字符", 400);
  if (!systemPrompt) return err(40001, "systemPrompt 必填", 400);

  const perspectiveType = typeof body.perspectiveType === "string" ? body.perspectiveType : "custom";
  if (!ALLOWED_TYPES.includes(perspectiveType)) {
    return err(40001, "perspectiveType 不在允许范围", 400);
  }

  const persona = await prisma.persona.create({
    data: {
      name,
      description: typeof body.description === "string" ? body.description : null,
      systemPrompt,
      perspectiveType: perspectiveType as PerspectiveType,
      avatarType: typeof body.avatarType === "string" && body.avatarType === "builtin" ? "builtin" : "auto",
      avatarValue: typeof body.avatarValue === "string" ? body.avatarValue : null,
      tags: Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === "string") : [],
      isBuiltin: false,
    },
    select: { id: true, name: true, perspectiveType: true, isBuiltin: true, createdAt: true },
  });

  return ok(persona);
}
