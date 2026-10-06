// Public: create or update a ShareApproval (draft or approved).
// POST /api/share/:slug/approval

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase";
import { sendShareApprovalNotification } from "@/lib/share-email";

const SNAPSHOTS_BUCKET = process.env.SUPABASE_SNAPSHOTS_BUCKET ?? "snapshots";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params;

  const body = await request.json() as {
    sessionId: string;
    clientEmail: string;
    designId: string;
    operations: Record<string, unknown>;
    thumbnailDataUrl?: string;
    status: "draft" | "approved";
  };

  if (!body.sessionId || !body.clientEmail || !body.designId || !body.status) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Look up the share link with tenant info
  const shareLink = await db.shareLink.findUnique({
    where: { slug },
    select: {
      id: true,
      isActive: true,
      clientName: true,
      clientEmail: true,
      createdBy: true,
      tenant: {
        select: {
          id: true,
          adminEmail: true,
          displayName: true,
          name: true,
          domain: true,
          slug: true,
        },
      },
    },
  });

  if (!shareLink || !shareLink.isActive) {
    return NextResponse.json({ error: "Share link not found or inactive" }, { status: 404 });
  }

  // Look up the design name for emails
  const design = await db.design.findUnique({
    where: { id: body.designId },
    select: { id: true, name: true },
  });
  if (!design) {
    return NextResponse.json({ error: "Design not found" }, { status: 404 });
  }

  // Upload thumbnail if provided
  let thumbnailUrl: string | null = null;
  if (body.thumbnailDataUrl) {
    try {
      const admin = createAdminClient();
      const base64 = body.thumbnailDataUrl.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64, "base64");
      const isJpeg = body.thumbnailDataUrl.startsWith("data:image/jpeg");
      const ext = isJpeg ? "jpg" : "png";
      const contentType = isJpeg ? "image/jpeg" : "image/png";
      const storagePath = `share/${slug}/${body.designId}_${Date.now()}.${ext}`;

      const { error } = await admin.storage
        .from(SNAPSHOTS_BUCKET)
        .upload(storagePath, buffer, { contentType, upsert: true });

      if (!error) {
        const { data } = admin.storage.from(SNAPSHOTS_BUCKET).getPublicUrl(storagePath);
        thumbnailUrl = data.publicUrl;
      }
    } catch (err) {
      console.error("[ShareApproval] Thumbnail upload failed:", err);
    }
  }

  // Upsert: find existing draft for this link+design+email, or create new
  const existing = await db.shareApproval.findFirst({
    where: {
      shareLinkId: shareLink.id,
      designId: body.designId,
      clientEmail: body.clientEmail.toLowerCase(),
      status: "draft",
    },
    select: { id: true },
  });

  let approval;
  if (existing) {
    approval = await db.shareApproval.update({
      where: { id: existing.id },
      data: {
        operations: body.operations as never,
        thumbnail: thumbnailUrl ?? undefined,
        status: body.status,
      },
      select: { id: true, status: true },
    });
  } else {
    approval = await db.shareApproval.create({
      data: {
        shareLinkId: shareLink.id,
        clientEmail: body.clientEmail.trim().toLowerCase(),
        designId: body.designId,
        operations: body.operations as never,
        thumbnail: thumbnailUrl,
        status: body.status,
      },
      select: { id: true, status: true },
    });
  }

  // Send notification emails on approval (fire-and-forget)
  if (body.status === "approved") {
    const domain = shareLink.tenant.domain
      ?? `${shareLink.tenant.slug}.loomstudio.com`;

    sendShareApprovalNotification({
      clientName: shareLink.clientName,
      clientEmail: body.clientEmail,
      designName: design.name,
      tenantName: shareLink.tenant.displayName ?? shareLink.tenant.name,
      thumbnailUrl,
      shareUrl: `https://${domain}/share/${slug}`,
      createdBy: shareLink.createdBy,
      tenantAdminEmail: shareLink.tenant.adminEmail,
    }).catch((err) => {
      console.error("[ShareApproval] Email notification failed:", err);
    });
  }

  return NextResponse.json({ id: approval.id, status: approval.status }, { status: 201 });
}
