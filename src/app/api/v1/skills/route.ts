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
        revisions: {
          select: { id: true, version: true, contentHash: true, packageRoot: true, installedAt: true },
          orderBy: { installedAt: "desc" },
          take: 5,
        },
      },
    }),
  ]);

  return ok({
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description,
      category: i.category,
      source: i.source,
      sourceRef: i.sourceRef,
      isBuiltin: i.isBuiltin,
      version: i.version,
      tags: i.tags,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      revisions: i.revisions.map((r) => ({
        id: r.id,
        version: r.version,
        contentHash: r.contentHash,
        hasPackage: !!r.packageRoot,
        installedAt: r.installedAt,
      })),
    })),
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: Math.ceil(total / pageSize),
    },
  });
}

/** POST /api/v1/skills — 禁止会话直接创建 Skill；必须通过 npx 导入安装不可变版本 */
export async function POST(_req: Request) {
  return err(40901, "不支持直接创建 Skill。请通过 npx 导入安装不可变版本。", 409);
}
