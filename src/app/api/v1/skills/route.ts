import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";

/** GET /api/v1/skills — 列表（search/category/page/page_size） */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() ?? "";
  const category = searchParams.get("category")?.trim() || undefined;
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("page_size") ?? 20) || 20));

  const where = {
    ...(category ? { category } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search } },
            { description: { contains: search } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.skill.count({ where }),
    prisma.skill.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        source: true,
        sourceRef: true,
        isBuiltin: true,
        version: true,
        tags: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return ok({
    items,
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: Math.ceil(total / pageSize),
    },
  });
}

/** POST /api/v1/skills — 新增 skill */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const instructions = typeof body.instructions === "string" ? body.instructions.trim() : "";

  if (!name || name.length > 100) return err(40001, "name 必填且不超过 100 字符", 400);
  if (!instructions) return err(40001, "instructions 必填", 400);

  const category = typeof body.category === "string" && body.category ? body.category : "通用";
  const description = typeof body.description === "string" ? body.description : null;
  const tags = Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === "string") : [];

  const skill = await prisma.skill.create({
    data: {
      name,
      description,
      category,
      instructions,
      inputSchema: body.inputSchema ?? undefined,
      outputSchema: body.outputSchema ?? undefined,
      tags,
      source: "manual",
      isBuiltin: false,
    },
    select: { id: true, name: true, category: true, isBuiltin: true, createdAt: true },
  });

  return ok(skill);
}
