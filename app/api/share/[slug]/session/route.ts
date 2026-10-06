// Public: create a ShareSession when a client enters their email.
// POST /api/share/:slug/session

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params;

  const body = await request.json() as {
    clientEmail: string;
    emailMatch: boolean;
  };

  if (!body.clientEmail?.trim()) {
    return NextResponse.json({ error: "clientEmail is required" }, { status: 400 });
  }

  const shareLink = await db.shareLink.findUnique({
    where: { slug },
    select: { id: true, isActive: true },
  });

  if (!shareLink || !shareLink.isActive) {
    return NextResponse.json({ error: "Share link not found or inactive" }, { status: 404 });
  }

  const session = await db.shareSession.create({
    data: {
      shareLinkId: shareLink.id,
      clientEmail: body.clientEmail.trim().toLowerCase(),
      emailMatch: body.emailMatch,
    },
    select: { id: true },
  });

  return NextResponse.json({ sessionId: session.id }, { status: 201 });
}
