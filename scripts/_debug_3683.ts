import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "fs";
import path from "path";
import type { PaletteEntry } from "@/types";

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

  const design3683 = await db.design.findFirst({ where: { slug: "3683" }, select: { palette: true, name: true } });
  const design3460 = await db.design.findFirst({ where: { slug: { startsWith: "3460" } }, select: { palette: true, name: true, slug: true } });

  // Load the JSON as the design page does
  const lookupPath = path.join(process.cwd(), "data", "oneloom-rendered-lookup.json");
  const raw = JSON.parse(fs.readFileSync(lookupPath, "utf-8")) as Record<string, unknown>;
  const renderedLookup = new Map(
    Object.entries(raw)
      .filter(([k]) => /^#[0-9a-f]{6}$/i.test(k))
      .map(([k, v]) => [k.toLowerCase(), v])
  );
  console.log("JSON lookup size:", renderedLookup.size);
  const sampleVal = renderedLookup.get("#b6c3c2");
  console.log("Sample value type:", typeof sampleVal, "value:", JSON.stringify(sampleVal));

  for (const [designName, design] of [["3683", design3683], ["3460", design3460]] as const) {
    if (!design) { console.log(`\n${designName}: NOT IN DB`); continue; }
    console.log(`\n--- ${designName} (${(design.palette as PaletteEntry[]).length} colors) ---`);
    for (const entry of (design.palette as PaletteEntry[])) {
      const val = renderedLookup.get(entry.hex.toLowerCase());
      const inJson = val !== undefined;
      const code = inJson
        ? (typeof val === "string" ? val : (val as { code: string }).code)
        : entry.matchedYarnCode;
      console.log(`  ${entry.hex}  inJSON:${inJson}  matchedYarnCode:${entry.matchedYarnCode ?? "–"}  runtimeCode:${typeof val === "object" ? "[object]" : val ?? "undef"}  effectiveCode:${code ?? "NONE"}`);
    }
  }

  await db.$disconnect();
}
main().catch(console.error);
