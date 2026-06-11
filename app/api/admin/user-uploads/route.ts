// Admin-only endpoint: returns all user-uploaded designs grouped by uploader,
// each paired with the uploader's saved colorway (if they have one).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { getSignedUrl, USER_DESIGNS_BUCKET } from "@/lib/supabase";

export async function GET() {
  // Admin guard
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // ── Fetch all user-uploaded designs with their uploaders ──────────────────
  const rawDesigns = await db.design.findMany({
    where: { uploadedById: { not: null } },
    select: {
      id: true,
      name: true,
      imageUrl: true,
      createdAt: true,
      uploadedBy: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (rawDesigns.length === 0) {
    return NextResponse.json({ groups: [] });
  }

  // ── Fetch uploader's saved colorway for each design ───────────────────────
  // We want specifically the colorway saved by the person who uploaded the design,
  // not colorways saved by other users who viewed it.
  const uploaderIds = rawDesigns.map((d) => d.uploadedBy!.id);
  const designIds = rawDesigns.map((d) => d.id);

  const savedColorways = await db.savedColorway.findMany({
    where: {
      designId: { in: designIds },
      userId: { in: uploaderIds },
    },
    select: {
      designId: true,
      userId: true,
      colorMapping: true,
      snapshotUrl: true,
      updatedAt: true,
    },
  });

  // Index by "designId::userId" for O(1) lookup
  const colorwayIndex = new Map(
    savedColorways.map((sc) => [`${sc.designId}::${sc.userId}`, sc])
  );

  // ── Generate signed URLs for design thumbnails ─────────────────────────────
  // All user-uploaded designs live in the private user-designs bucket.
  const withUrls = await Promise.all(
    rawDesigns.map(async (d) => {
      const imageUrl = await getSignedUrl(USER_DESIGNS_BUCKET, d.imageUrl);
      const sc = colorwayIndex.get(`${d.id}::${d.uploadedBy!.id}`);

      return {
        id: d.id,
        name: d.name,
        imageUrl,
        createdAt: d.createdAt.toISOString(),
        uploadedBy: d.uploadedBy!,
        savedColorway: sc
          ? {
              colorCount: Object.keys(
                sc.colorMapping as Record<string, unknown>
              ).length,
              snapshotUrl: sc.snapshotUrl,
              updatedAt: sc.updatedAt.toISOString(),
            }
          : null,
      };
    })
  );

  // ── Group by uploader ─────────────────────────────────────────────────────
  const groupMap = new Map<
    string,
    { user: { id: string; name: string | null; email: string }; designs: typeof withUrls }
  >();

  for (const d of withUrls) {
    const uid = d.uploadedBy.id;
    if (!groupMap.has(uid)) {
      groupMap.set(uid, { user: d.uploadedBy, designs: [] });
    }
    groupMap.get(uid)!.designs.push(d);
  }

  const groups = Array.from(groupMap.values());

  return NextResponse.json({ groups });
}
