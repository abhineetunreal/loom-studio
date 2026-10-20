import { NextResponse } from "next/server";
import { validateAiAccess } from "@/lib/ai/auth";
import { listAiSessions } from "@/lib/ai/session";

export async function GET() {
  const auth = await validateAiAccess();
  if (!auth) {
    return NextResponse.json(
      { error: "Unauthorized — PlatformUser access required" },
      { status: 401 },
    );
  }

  const sessions = await listAiSessions(auth.platformUserId, auth.tenantId);

  return NextResponse.json({ sessions });
}
