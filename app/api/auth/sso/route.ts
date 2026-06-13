import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase";
import { verifySSOToken } from "@/lib/sso";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token = searchParams.get("token");
  const tenantSlug = searchParams.get("tenant");

  if (!token || !tenantSlug) {
    return NextResponse.redirect(new URL("/?error=sso_missing_params", origin));
  }

  // Look up tenant by slug
  const tenant = await db.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, ssoSecret: true },
  });

  if (!tenant || !tenant.ssoSecret) {
    return NextResponse.redirect(new URL("/?error=sso_not_configured", origin));
  }

  // Verify token signature and expiry
  let payload: { email: string; name: string; tenant: string };
  try {
    payload = verifySSOToken(token, tenant.ssoSecret);
  } catch {
    return NextResponse.redirect(new URL("/?error=sso_invalid_token", origin));
  }

  const { email, name } = payload;

  // Ensure the Supabase auth user exists
  const supabaseAdmin = createAdminClient();
  try {
    await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: name, sso_source: "wordpress" },
    });
  } catch {
    // User already exists — that's fine, continue
  }

  // Generate a one-time magic link token
  const { data: linkData, error: linkError } =
    await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

  if (linkError || !linkData?.properties?.hashed_token) {
    return NextResponse.redirect(new URL("/?error=sso_link_failed", origin));
  }

  const hashedToken = linkData.properties.hashed_token;

  // Ensure TenantUser exists for this email + tenant
  const existing = await db.tenantUser.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    select: { id: true, role: true },
  });

  if (!existing) {
    await db.tenantUser.create({
      data: {
        tenantId: tenant.id,
        email,
        name: name ?? null,
        role: "PENDING",
        provider: "sso",
      },
    });
  }

  // Redirect to client-side callback to establish session
  return NextResponse.redirect(
    new URL(
      `/auth/sso-callback?token_hash=${encodeURIComponent(hashedToken)}&type=email`,
      origin
    )
  );
}
