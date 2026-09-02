import { PrismaClient } from "@prisma/client";
import { genShortId } from "../src/lib/short-id.ts";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.discussion.findMany({
    where: { shortId: null },
    select: { id: true },
  });
  let done = 0;
  for (const r of rows) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const sid = genShortId();
      const exists = await prisma.discussion.count({ where: { shortId: sid } });
      if (exists === 0) {
        await prisma.discussion.update({ where: { id: r.id }, data: { shortId: sid } });
        done++;
        break;
      }
    }
  }
  console.log(`backfilled shortId for ${done} discussions`);
  const total = await prisma.discussion.count();
  console.log(`discussions now: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
