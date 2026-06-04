/**
 * scripts/import-yarn-libraries.ts
 *
 * Imports yarn colors from three XML library files into the database.
 * Clears all existing yarn rows first (safe in dev; check for submissions in prod).
 *
 * XML format: <Colors> elements with <Name>, <r>, <g>, <b> fields.
 *
 * Library → code prefix mapping (prevents cross-library code collisions):
 *   Oneloom_Corrected.xml  → "OneLoom"  → code prefix "OneLoom:"
 *   ARS1400DB.XML          → "ARS 1400" → code prefix "ARS1400:"
 *   ARS1200DB.XML          → "ARS 1200" → code prefix "ARS1200:"
 *
 * Library name is stored in the `material` field (no material data in these XMLs).
 *
 * Usage:
 *   npx tsx scripts/import-yarn-libraries.ts
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

// ─── XML parsing ──────────────────────────────────────────────────────────────

type YarnRecord = {
  code: string;
  name: string;
  hex: string;
  library: string;
  sortOrder: number;
};

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0"))
      .join("")
  );
}

function getTag(block: string, tag: string): string {
  // Handles self-closing absence (minOccurs="0") and present elements
  const match = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match ? match[1].trim() : "";
}

function parseXml(filePath: string, libraryName: string, codePrefix: string): YarnRecord[] {
  const content = fs.readFileSync(filePath, "utf-8");

  // Extract all <Colors>…</Colors> data blocks (skip the xs:schema header)
  const blocks = content.match(/<Colors>([\s\S]*?)<\/Colors>/g) ?? [];

  const records: YarnRecord[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const name = getTag(block, "Name");
    if (!name) continue; // skip if Name is missing

    const r = parseInt(getTag(block, "r") || "0", 10);
    const g = parseInt(getTag(block, "g") || "0", 10);
    const b = parseInt(getTag(block, "b") || "0", 10);

    records.push({
      code: `${codePrefix}:${name}`,
      name,
      hex: rgbToHex(r, g, b),
      library: libraryName,
      sortOrder: i,
    });
  }

  return records;
}

// ─── Libraries to import ──────────────────────────────────────────────────────

const LIBRARIES = [
  {
    file: "Oneloom_Corrected.xml",
    libraryName: "OneLoom",
    codePrefix: "OneLoom",
  },
  {
    file: "ARS1400DB.XML",
    libraryName: "ARS 1400",
    codePrefix: "ARS1400",
  },
  {
    file: "ARS1200DB.XML",
    libraryName: "ARS 1200",
    codePrefix: "ARS1200",
  },
] as const;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // --- Parse all files first so we fail fast before touching the DB ---
  const allRecords: { library: string; yarns: YarnRecord[] }[] = [];

  for (const lib of LIBRARIES) {
    const filePath = path.join(process.cwd(), "data", lib.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: data/${lib.file}`);
    }
    const yarns = parseXml(filePath, lib.libraryName, lib.codePrefix);
    if (yarns.length === 0) {
      throw new Error(`No <Colors> entries found in data/${lib.file}`);
    }
    allRecords.push({ library: lib.libraryName, yarns });
  }

  // --- Clear existing yarn data ---
  console.log("Clearing existing yarn data...");
  const deletedMappings = await db.submissionColorMapping.deleteMany({});
  const deletedYarns = await db.yarnColor.deleteMany({});
  console.log(
    `  Removed ${deletedYarns.count} yarn(s) and ${deletedMappings.count} submission mapping(s).`
  );

  // --- Import each library ---
  let grandTotal = 0;

  for (const { library, yarns } of allRecords) {
    console.log(`\nImporting "${library}" (${yarns.length} colors)...`);

    // Batch insert in chunks of 500 to stay within pg parameter limits
    const CHUNK = 500;
    for (let i = 0; i < yarns.length; i += CHUNK) {
      await db.yarnColor.createMany({
        data: yarns.slice(i, i + CHUNK).map((yarn) => ({
          code: yarn.code,
          name: yarn.name,
          hex: yarn.hex,
          material: yarn.library,
          sortOrder: yarn.sortOrder,
        })),
        skipDuplicates: true,
      });
    }

    console.log(`  ✓ ${library}: ${yarns.length} colors`);
    grandTotal += yarns.length;
  }

  // --- Summary ---
  console.log("\n─────────────────────────────");
  console.log("Import complete. Color counts:");
  for (const { library, yarns } of allRecords) {
    console.log(`  ${library.padEnd(12)} ${yarns.length}`);
  }
  console.log("  " + "─".repeat(20));
  console.log(`  ${"Grand total".padEnd(12)} ${grandTotal}`);
  console.log("─────────────────────────────");
}

main()
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
