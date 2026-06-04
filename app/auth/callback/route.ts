import { NextRequest, NextResponse } from "next/server";
import { createAuthClient } from "@/lib/supabase-server";
import { db } from "@/lib/db";

// Handles both OAuth (Google) and magic link redirects from Supabase.
// Supabase redirects here with ?code=... after successful auth.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createAuthClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.session?.user.email) {
      const rawProvider = data.session.user.app_metadata?.provider as string | undefined;
      const provider = rawProvider === "google" ? "google" : "magic_link";
      await upsertTenantUser(
        data.session.user.email,
        data.session.user.id,
        data.session.user.user_metadata?.full_name as string | undefined,
        provider
      );
    }
  }

  return NextResponse.redirect(new URL(next, origin));
}

// ─── Tenant user provisioning ─────────────────────────────────────────────────
//
// On first sign-in, create a TenantUser row for the default tenant.
// Admin email gets ADMIN role; everyone else starts as PENDING.
//
// TODO: When multi-tenant subdomain routing is added, resolve the tenant from
// the request hostname instead of always using the default slug.

async function upsertTenantUser(
  email: string,
  authUserId: string,
  name?: string,
  provider?: string
): Promise<void> {
  try {
    const tenant = await db.tenant.findUnique({
      where: { slug: "carpetsbazaar" },
      select: { id: true, adminEmail: true },
    });

    if (!tenant) return; // tenant not seeded yet — skip silently

    const isAdmin = email.toLowerCase() === tenant.adminEmail.toLowerCase();

    await db.tenantUser.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      update: { authUserId, name: name ?? undefined, provider: provider ?? undefined },
      create: {
        tenantId: tenant.id,
        email,
        name: name ?? null,
        authUserId,
        provider: provider ?? null,
        role: isAdmin ? "ADMIN" : "PENDING",
      },
    });
  } catch (err) {
    // Don't break the auth flow if DB write fails
    console.error("Failed to upsert TenantUser:", err);
  }
}
