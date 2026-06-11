import { NextRequest, NextResponse } from "next/server";
import { createAuthClient } from "@/lib/supabase-server";
import { db } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";

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
// On every sign-in: ensure a TenantUser row exists for the current-domain tenant.
// If the user's email matches any tenant's adminEmail, they get OWNER for that
// tenant (cross-tenant — not limited to the current domain).

async function upsertTenantUser(
  email: string,
  authUserId: string,
  name?: string,
  provider?: string
): Promise<void> {
  try {
    // Find all tenants where this email is the admin
    const ownerTenants = await db.tenant.findMany({
      where: { adminEmail: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    const ownerTenantIds = new Set(ownerTenants.map((t) => t.id));

    // Upsert OWNER for each matching tenant
    for (const { id: tenantId } of ownerTenants) {
      await db.tenantUser.upsert({
        where: { tenantId_email: { tenantId, email } },
        update: {
          authUserId,
          name: name ?? undefined,
          provider: provider ?? undefined,
          role: "OWNER" as const,
        },
        create: {
          tenantId,
          email,
          name: name ?? null,
          authUserId,
          provider: provider ?? null,
          role: "OWNER",
        },
      });
    }

    // Upsert current-domain tenant as PENDING (only on create, don't demote existing)
    const currentTenant = await getCurrentTenant();
    if (currentTenant && !ownerTenantIds.has(currentTenant.id)) {
      await db.tenantUser.upsert({
        where: { tenantId_email: { tenantId: currentTenant.id, email } },
        update: {
          authUserId,
          name: name ?? undefined,
          provider: provider ?? undefined,
        },
        create: {
          tenantId: currentTenant.id,
          email,
          name: name ?? null,
          authUserId,
          provider: provider ?? null,
          role: "PENDING",
        },
      });
    }
  } catch (err) {
    // Don't break the auth flow if DB write fails
    console.error("Failed to upsert TenantUser:", err);
  }
}
