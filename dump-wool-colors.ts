import { PrismaClient } from "./app/generated/prisma";
import * as fs from "fs";
const db = new PrismaClient();
async function main() {
  const t = await db.tenant.findFirst({ where: { slug: "carpetsbazaar" } });
  if (!t) { console.error("Tenant not found"); process.exit(1); }
  const y = await db.yarnColor.findMany({ where: { tenantId: t.id, isActive: true, material: { equals: "Wool_Colors", mode: "insensitive" } }, select: { code: true, hex: true, name: true, swatchImageUrl: true }, orderBy: { code: "asc" } });
  fs.writeFileSync("wool-colors-dump.json", JSON.stringify(y, null, 2));
  console.log(`Dumped ${y.length} yarns`);
  await db.$disconnect();
}
main();

