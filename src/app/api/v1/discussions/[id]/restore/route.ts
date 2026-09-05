import { err, ok } from "@/lib/api";
import { restoreDiscussion } from "@/lib/discussion/archive";

/** POST /api/v1/discussions/:id/restore — 恢复已归档讨论（TTL 前均可） */
export async function POST(_req: Request, ctx: RouteContext<"/api/v1/discussions/[id]/restore">) {
  const { id } = await ctx.params;
  try {
    await restoreDiscussion(id);
  } catch (e) {
    if (e instanceof Error && (e as { code?: string }).code === "DISCUSSION_ARCHIVED") {
      return err(40901, e.message, 409);
    }
    return err(40401, e instanceof Error ? e.message : "恢复失败", 404);
  }
  return ok(null);
}
