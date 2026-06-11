import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { revalidatePath } from "next/cache";

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/users/[id]">
) {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await ctx.params;

  const body = await request.json();
  if (typeof body.canUpload !== "boolean") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  await db.tenantUser.update({
    where: { id },
    data: { canUpload: body.canUpload },
  });

  revalidatePath("/admin");
  return NextResponse.json({ ok: true });
}
