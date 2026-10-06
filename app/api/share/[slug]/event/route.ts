// Public: log an analytics event to a share session.
// POST /api/share/:slug/event

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params;

  const body = await request.json() as {
    sessionId: string;
    type: string;
    detail?: Record<string, unknown>;
  };

  if (!body.sessionId || !body.type) {
    return NextResponse.json({ error: "sessionId and type are required" }, { status: 400 });
  }

  // Verify session belongs to this share link
  const session = await db.shareSession.findFirst({
    where: {
      id: body.sessionId,
      shareLink: { slug },
    },
    select: { id: true, actions: true, actionCount: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const existingActions = Array.isArray(session.actions) ? session.actions : [];
  const newAction = {
    type: body.type,
    detail: body.detail ?? null,
    at: new Date().toISOString(),
  };

  await db.shareSession.update({
    where: { id: session.id },
    data: {
      actions: [...existingActions, newAction] as never,
      actionCount: session.actionCount + 1,
      lastActivityAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
