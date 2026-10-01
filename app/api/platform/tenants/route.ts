import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET /api/platform/tenants — list all tenants (PlatformUser only)
export async function GET() {
  const session = await getSession();
  if (!session?.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const platformUser = await db.platformUser.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });

  if (!platformUser) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tenants = await db.tenant.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      displayName: true,
      slug: true,
      domain: true,
      _count: { select: { designs: true, users: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    tenants: tenants.map((t) => ({
      id: t.id,
      name: t.displayName ?? t.name,
      slug: t.slug,
      domain: t.domain,
      designCount: t._count.designs,
      userCount: t._count.users,
    })),
  });
}
