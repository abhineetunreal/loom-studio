// Admin-only: generate a Supabase signed upload URL for the public designs bucket.
// The browser PUTs the BMP directly to Storage; the body never passes through
// our server (avoids Vercel's 4.5 MB body limit for large BMPs).
//
// GET /api/admin/designs/signed-upload-url?filename=foo.bmp
// Returns: { signedUrl, storagePath, slug, token }

import { NextRequest, NextResponse } from "next/server";
import { getDefaultTierInfo } from "@/lib/tier";
import { createAdminClient, DESIGNS_BUCKET } from "@/lib/supabase";

function filenameToSlug(filename: string): string {
  return filename
    .replace(/\.(bmp|ctf)$/i, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export async function GET(request: NextRequest) {
  // ── Admin guard ────────────────────────────────────────────────────────────
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // ── Validate query param ───────────────────────────────────────────────────
  const filename = request.nextUrl.searchParams.get("filename") ?? "";
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".bmp") && !lower.endsWith(".ctf")) {
    return NextResponse.json({ error: "filename must end with .bmp or .ctf" }, { status: 400 });
  }

  const slug = filenameToSlug(filename);
  if (!slug) {
    return NextResponse.json({ error: "filename produces an empty slug" }, { status: 400 });
  }

  // ── Generate signed upload URL ─────────────────────────────────────────────
  const ext = lower.endsWith(".ctf") ? "ctf" : "bmp";
  const uuid8 = crypto.randomUUID().slice(0, 8);
  const storagePath = `${slug}/${uuid8}.${ext}`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(DESIGNS_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    console.error("createSignedUploadUrl error:", error);
    return NextResponse.json({ error: "Failed to create upload URL" }, { status: 500 });
  }

  // token is embedded in signedUrl — we don't need to return it separately.
  return NextResponse.json({ signedUrl: data.signedUrl, storagePath, slug });
}
