// Admin-only: manage share links for client approval.
//
// POST /api/admin/share-links  — create a new share link
// GET  /api/admin/share-links  — list all share links for this tenant

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { getCurrentTenant } from "@/lib/tenant";
import { getSession } from "@/lib/auth";
import { generateSlug } from "@/lib/share-utils";

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 });
  }

  // Fetch tenant domain for URL generation
  const tenantRow = await db.tenant.findUnique({
    where: { id: tenant.id },
    select: { domain: true, slug: true },
  });

  const shareLinks = await db.shareLink.findMany({
    where: { tenantId: tenant.id },
    include: {
      primaryDesign: {
        select: { id: true, name: true, imageUrl: true },
      },
      _count: {
        select: { sessions: true, approvals: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Compute session stats per link
  const linkIds = shareLinks.map((l) => l.id);
  const sessions = linkIds.length > 0
    ? await db.shareSession.findMany({
        where: { shareLinkId: { in: linkIds } },
        select: {
          shareLinkId: true,
          startedAt: true,
          emailMatch: true,
        },
      })
    : [];

  const sessionStatsByLink = new Map<string, {
    totalVisits: number;
    lastVisitAt: string | null;
    hasEmailMismatch: boolean;
  }>();

  for (const s of sessions) {
    const existing = sessionStatsByLink.get(s.shareLinkId) ?? {
      totalVisits: 0,
      lastVisitAt: null,
      hasEmailMismatch: false,
    };
    existing.totalVisits++;
    const startedStr = s.startedAt.toISOString();
    if (!existing.lastVisitAt || startedStr > existing.lastVisitAt) {
      existing.lastVisitAt = startedStr;
    }
    if (!s.emailMatch) existing.hasEmailMismatch = true;
    sessionStatsByLink.set(s.shareLinkId, existing);
  }

  const domain = tenantRow?.domain ?? `${tenantRow?.slug ?? "app"}.loomstudio.com`;

  const result = shareLinks.map((link) => ({
    ...link,
    sessionStats: sessionStatsByLink.get(link.id) ?? {
      totalVisits: 0,
      lastVisitAt: null,
      hasEmailMismatch: false,
    },
    shareUrl: `https://${domain}/share/${link.slug}`,
  }));

  return NextResponse.json({ shareLinks: result });
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 });
  }

  const session = await getSession();
  if (!session?.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as {
    clientName: string;
    clientEmail: string;
    primaryDesignId: string;
    additionalDesignIds?: string[];
    allowedLibraries?: string[];
    presets?: { colorwayId: string; displayName: string }[];
  };

  if (!body.clientName?.trim()) {
    return NextResponse.json({ error: "clientName is required" }, { status: 400 });
  }
  if (!body.clientEmail?.trim()) {
    return NextResponse.json({ error: "clientEmail is required" }, { status: 400 });
  }
  if (!body.primaryDesignId) {
    return NextResponse.json({ error: "primaryDesignId is required" }, { status: 400 });
  }

  // Verify primary design belongs to this tenant
  const design = await db.design.findFirst({
    where: { id: body.primaryDesignId, tenantId: tenant.id },
    select: { id: true },
  });
  if (!design) {
    return NextResponse.json({ error: "Primary design not found" }, { status: 404 });
  }

  // Generate unique slug (retry on collision)
  let slug = generateSlug();
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await db.shareLink.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) break;
    slug = generateSlug();
  }

  const tenantRow = await db.tenant.findUnique({
    where: { id: tenant.id },
    select: { domain: true, slug: true },
  });

  const shareLink = await db.shareLink.create({
    data: {
      tenantId: tenant.id,
      slug,
      clientName: body.clientName.trim(),
      clientEmail: body.clientEmail.trim().toLowerCase(),
      primaryDesignId: body.primaryDesignId,
      additionalDesignIds: (body.additionalDesignIds ?? []) as never,
      allowedLibraries: (body.allowedLibraries ?? []) as never,
      presets: (body.presets ?? []) as never,
      createdBy: session.user.email,
    },
    include: {
      primaryDesign: {
        select: { id: true, name: true, imageUrl: true },
      },
    },
  });

  const domain = tenantRow?.domain ?? `${tenantRow?.slug ?? "app"}.loomstudio.com`;

  return NextResponse.json(
    {
      shareLink,
      shareUrl: `https://${domain}/share/${slug}`,
    },
    { status: 201 }
  );
}
