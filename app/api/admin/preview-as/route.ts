import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDefaultTierInfo } from "@/lib/tier";

const COOKIE_NAME = "previewAsUser";

// POST /api/admin/preview-as — set or clear the preview-as-user cookie
export async function POST(req: NextRequest) {
  const tierInfo = await getDefaultTierInfo();
  if (tierInfo.tier !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Support both JSON body and form data (for the exit button form)
  const contentType = req.headers.get("content-type") ?? "";
  let action: string | null = null;
  let email: string | null = null;

  if (contentType.includes("application/json")) {
    const body = await req.json();
    action = body.action ?? null;
    email = body.email ?? null;
  } else {
    const formData = await req.formData();
    action = formData.get("action") as string | null;
    email = formData.get("email") as string | null;
  }

  const cookieStore = await cookies();

  if (action === "exit") {
    cookieStore.delete(COOKIE_NAME);
    // Redirect back to the main page
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  cookieStore.set(COOKIE_NAME, email.toLowerCase().trim(), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60, // 1 hour
  });

  return NextResponse.json({ ok: true, previewAs: email.toLowerCase().trim() });
}
