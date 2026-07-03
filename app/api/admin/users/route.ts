import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";

// GET /api/admin/users — list all tenant members (admin only)
export async function GET() {
  const session = await getSession();
  if (!session?.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const actor = await db.tenantUser.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: session.user.email } },
    select: { role: true },
  });

  if (!actor || (actor.role !== "OWNER" && actor.role !== "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await db.tenantUser.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, email: true, name: true, role: true },
    orderBy: { email: "asc" },
  });

  return NextResponse.json({ users });
}
