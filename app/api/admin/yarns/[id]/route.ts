// Admin-only: update a single yarn record.
//
// PATCH /api/admin/yarns/:id
//   Body: { swatchScale?: number }
//   Returns: { ok: true, swatchScale: number }

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { getCurrentTenant } from "@/lib/tenant";

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json() as { swatchScale?: number };

  if (body.swatchScale !== undefined) {
    const scale = Number(body.swatchScale);
    if (!isFinite(scale) || scale <= 0) {
      return NextResponse.json({ error: "swatchScale must be a positive number" }, { status: 400 });
    }
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 });
  }

  const data: { swatchScale?: number } = {};
  if (body.swatchScale !== undefined) data.swatchScale = Number(body.swatchScale);

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
  }

  const updated = await db.yarnColor.update({
    where: { id, tenantId: tenant.id },
    data,
    select: { id: true, swatchScale: true },
  });

  return NextResponse.json({ ok: true, swatchScale: updated.swatchScale });
}
