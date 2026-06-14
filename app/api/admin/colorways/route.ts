import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { getCurrentTenant } from "@/lib/tenant";

// ─── GET /api/admin/colorways ─────────────────────────────────────────────────
// All saved colorways for this tenant, grouped by userEmail, for the admin view.
export async function GET() {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const tenant = await getCurrentTenant();
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const colorways = await db.savedColorway.findMany({
    where: { tenantId: tenant.id },
    select: {
      id: true,
      name: true,
      userEmail: true,
      snapshotUrl: true,
      createdAt: true,
      design: { select: { id: true, name: true } },
      folder: { select: { id: true, name: true } },
    },
    orderBy: [{ userEmail: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ colorways });
}
