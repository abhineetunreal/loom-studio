import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({ connectionString });
  const db = new PrismaClient({ adapter });
  const r = await db.tenantUser.updateMany({
    where: { email: "abhineet.rcc@gmail.com" },
    data: { role: "OWNER" },
  });
  console.log(`Updated ${r.count} row(s) to OWNER`);
  await db.$disconnect();
}

main().catch(console.error);
