import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";

/** POST /api/v1/recipes/:id/duplicate — 复制配方（含步骤） */
export async function POST(_req: Request, ctx: RouteContext<"/api/v1/recipes/[id]/duplicate">) {
  const { id } = await ctx.params;
  const recipe = await prisma.recipe.findUnique({
    where: { id },
    include: {
      steps: { orderBy: { position: "asc" }, select: { skillId: true, personaId: true, inputMapping: true } },
    },
  });
  if (!recipe) return err(40401, "配方不存在", 404);

  const copy = await prisma.recipe.create({
    data: {
      name: `${recipe.name}（副本）`,
      description: recipe.description,
      steps: {
        createMany: {
          data: recipe.steps.map((s, i) => ({
            position: i + 1,
            skillId: s.skillId,
            personaId: s.personaId ?? undefined,
            inputMapping: s.inputMapping ?? undefined,
          })),
        },
      },
    },
    select: { id: true, name: true },
  });

  return ok(copy);
}
