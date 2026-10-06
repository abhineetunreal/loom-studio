// Returns saved colorways for a specific design within the current tenant.
// Used by the share link creation form's preset picker.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { getCurrentTenant } from "@/lib/tenant";

export async function GET(request: NextRequest) {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const designId = searchParams.get("designId");
  if (!designId) {
    return NextResponse.json({ error: "designId is required" }, { status: 400 });
  }

  const colorways = await db.savedColorway.findMany({
    where: { tenantId: tenant.id, designId },
    select: {
      id: true,
      name: true,
      snapshotUrl: true,
      designId: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ colorways });
}
