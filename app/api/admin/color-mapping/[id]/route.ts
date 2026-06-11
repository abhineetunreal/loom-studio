// Admin-only: delete a ColorLookup entry.
//
// DELETE /api/admin/color-mapping/[id]
// Returns: 204 No Content

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { getDefaultTierInfo } from "@/lib/tier";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;

  const tenant = await getCurrentTenant();
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 500 });

  const entry = await db.colorLookup.findFirst({
    where: { id, tenantId: tenant.id },
  });
  if (!entry) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.colorLookup.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}
