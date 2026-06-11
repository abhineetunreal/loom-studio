// Returns the authenticated user's uploaded designs with pre-signed thumbnail
// URLs.  Shows all uploads (isActive true and false) so the user sees
// pending-review designs immediately after uploading.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { getSignedUrl, USER_DESIGNS_BUCKET } from "@/lib/supabase";

export async function GET() {
  const authUser = await getUser();
  if (!authUser) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const tenant = await db.tenant.findUnique({
    where: { slug: process.env.DEFAULT_TENANT_SLUG ?? "carpetsbazaar" },
    select: { id: true },
  });
  if (!tenant) return NextResponse.json({ designs: [] });

  const tenantUser = await db.tenantUser.findFirst({
    where: { tenantId: tenant.id, authUserId: authUser.id },
    select: { id: true },
  });
  if (!tenantUser) return NextResponse.json({ designs: [] });

  const rawDesigns = await db.design.findMany({
    where: { uploadedById: tenantUser.id },
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      width: true,
      height: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Generate signed URLs in parallel — all uploads live in the private bucket.
  const designs = await Promise.all(
    rawDesigns.map(async (d) => ({
      ...d,
      imageUrl: await getSignedUrl(USER_DESIGNS_BUCKET, d.imageUrl),
    }))
  );

  return NextResponse.json({ designs });
}
