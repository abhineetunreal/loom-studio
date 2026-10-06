// Public: list existing approvals for a share link.
// GET /api/share/:slug/approvals

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params;

  const shareLink = await db.shareLink.findUnique({
    where: { slug },
    select: { id: true, isActive: true },
  });

  if (!shareLink) {
    return NextResponse.json({ error: "Share link not found" }, { status: 404 });
  }

  const approvals = await db.shareApproval.findMany({
    where: { shareLinkId: shareLink.id },
    select: {
      id: true,
      designId: true,
      clientEmail: true,
      operations: true,
      thumbnail: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ approvals });
}
