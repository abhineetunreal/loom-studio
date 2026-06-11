// Admin-only: list all ColorLookup entries (GET) and upsert a new mapping (POST).
//
// GET  /api/admin/color-mapping
//   Returns: { mappings: ColorMapping[] }
//
// POST /api/admin/color-mapping
//   Body: { hex: string; yarnCode: string }
//   Upserts a ColorLookup row and updates all catalog designs that have that
//   hex in their palette with no matched code.
//   Returns: { updatedDesigns: number }

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { getDefaultTierInfo } from "@/lib/tier";
import type { PaletteEntry } from "@/types";

async function getAdminTenant() {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") return null;
  return getCurrentTenant();
}

export async function GET() {
  const tenant = await getAdminTenant();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const mappings = await db.colorLookup.findMany({
    where: { tenantId: tenant.id },
    orderBy: { renderedHex: "asc" },
    select: {
      id: true,
      renderedHex: true,
      yarnCode: true,
      catalogHex: true,
      library: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ mappings });
}

export async function POST(request: NextRequest) {
  const tenant = await getAdminTenant();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  let body: { hex?: string; yarnCode?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const hex = body.hex?.toLowerCase().trim();
  const yarnCode = body.yarnCode?.trim();

  if (!hex || !/^#[0-9a-f]{6}$/.test(hex)) {
    return NextResponse.json({ error: "hex must be a valid #rrggbb color" }, { status: 400 });
  }
  if (!yarnCode) {
    return NextResponse.json({ error: "yarnCode is required" }, { status: 400 });
  }

  // Upsert the ColorLookup row
  await db.colorLookup.upsert({
    where: { tenantId_renderedHex: { tenantId: tenant.id, renderedHex: hex } },
    update: { yarnCode },
    create: { tenantId: tenant.id, renderedHex: hex, yarnCode, library: "OneLoom" },
  });

  // Find all catalog designs that have this hex in their palette without a code
  const designs = await db.design.findMany({
    where: { tenantId: tenant.id, uploadedById: null },
    select: { id: true, palette: true },
  });

  let updatedDesigns = 0;
  for (const design of designs) {
    const palette = design.palette as PaletteEntry[];
    const needsUpdate = palette.some(
      (e) => e.hex.toLowerCase() === hex && !e.matchedYarnCode
    );
    if (!needsUpdate) continue;

    const newPalette = palette.map((e) =>
      e.hex.toLowerCase() === hex
        ? { ...e, matchedYarnCode: yarnCode }
        : e
    );
    await db.design.update({
      where: { id: design.id },
      data: { palette: newPalette },
    });
    updatedDesigns++;
  }

  return NextResponse.json({ updatedDesigns }, { status: 200 });
}
