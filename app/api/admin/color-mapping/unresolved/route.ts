// Admin-only: return all palette colors across catalog designs that have no
// matched yarn code, deduplicated by hex.
//
// GET /api/admin/color-mapping/unresolved
// Returns: { unresolved: UnresolvedColor[] }
//   UnresolvedColor: { hex: string; designCount: number }

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import type { PaletteEntry } from "@/types";

export async function GET() {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const tenant = await db.tenant.findUnique({
    where: { slug: process.env.DEFAULT_TENANT_SLUG ?? "carpetsbazaar" },
    select: { id: true },
  });
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 500 });

  const designs = await db.design.findMany({
    where: { tenantId: tenant.id, uploadedById: null, isActive: true },
    select: { id: true, name: true, palette: true },
  });

  // Accumulate hex → ordered list of { id, name } (only unmatched entries)
  const hexToDesigns = new Map<string, Array<{ id: string; name: string }>>();
  for (const design of designs) {
    const palette = design.palette as PaletteEntry[];
    for (const entry of palette) {
      if (!entry.matchedYarnCode) {
        const h = entry.hex.toLowerCase();
        if (!hexToDesigns.has(h)) hexToDesigns.set(h, []);
        const list = hexToDesigns.get(h)!;
        if (!list.some((d) => d.id === design.id)) {
          list.push({ id: design.id, name: design.name });
        }
      }
    }
  }

  const unresolved = Array.from(hexToDesigns.entries())
    .map(([hex, designs]) => ({
      hex,
      designCount: designs.length,
      firstDesign: designs[0] ?? null,
    }))
    .sort((a, b) => b.designCount - a.designCount || a.hex.localeCompare(b.hex));

  return NextResponse.json({ unresolved });
}
