import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { getCurrentTenant } from "@/lib/tenant";
import { revalidatePath } from "next/cache";

export async function POST(request: NextRequest) {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const body = await request.json();
  const email: string = (body.email ?? "").trim().toLowerCase();
  const name: string | null = body.name?.trim() || null;

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const existing = await db.tenantUser.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    select: { role: true },
  });

  if (existing) {
    return NextResponse.json({ exists: true, role: existing.role }, { status: 409 });
  }

  await db.tenantUser.create({
    data: {
      tenantId: tenant.id,
      email,
      name,
      role: "APPROVED",
      canUpload: false,
    },
  });

  revalidatePath("/admin");
  return NextResponse.json({ ok: true });
}
