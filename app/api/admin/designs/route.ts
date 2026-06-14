// Admin-only: list all catalog designs (uploadedById is null).
// Used by the Manage Catalog tab to populate the existing-designs list.
//
// GET /api/admin/designs
// Returns: { designs: CatalogDesign[] }

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { getCurrentTenant } from "@/lib/tenant";
import type { PaletteEntry } from "@/types";

export type CatalogDesign = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string;
  width: number;
  height: number;
  colorCount: number;
  collectionId: string | null;
  externalSku: string | null;
  createdAt: string;
};

export async function GET() {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 });
  }

  const rows = await db.design.findMany({
    where: { tenantId: tenant.id, uploadedById: null },
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      width: true,
      height: true,
      palette: true,
      collectionId: true,
      externalSku: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const designs: CatalogDesign[] = rows.map((d) => ({
    id: d.id,
    name: d.name,
    slug: d.slug,
    imageUrl: d.imageUrl,
    width: d.width,
    height: d.height,
    colorCount: Array.isArray(d.palette)
      ? (d.palette as PaletteEntry[]).length
      : 0,
    collectionId: d.collectionId,
    externalSku: d.externalSku,
    createdAt: d.createdAt.toISOString(),
  }));

  return NextResponse.json({ designs });
}
