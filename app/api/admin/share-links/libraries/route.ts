// Returns unique yarn libraries (material values) for the current tenant,
// with yarn counts per library. Used by the share link creation form.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { getCurrentTenant } from "@/lib/tenant";

export async function GET() {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 });
  }

  const groups = await db.yarnColor.groupBy({
    by: ["material"],
    where: { tenantId: tenant.id, isActive: true },
    _count: { id: true },
  });

  const libraries = groups
    .filter((g) => g.material !== null)
    .map((g) => ({
      material: g.material as string,
      count: g._count.id,
    }))
    .sort((a, b) => a.material.localeCompare(b.material));

  return NextResponse.json({ libraries });
}
