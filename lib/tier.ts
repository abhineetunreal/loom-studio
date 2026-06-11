// Tier resolution — determines what a user can see for a given tenant.
//
// Tier  │ Who                                   │ What they see
// ──────┼───────────────────────────────────────┼────────────────────────────────
// demo  │ Unauthenticated, PENDING, DEMO role   │ isDemo designs only; yarn codes
//       │                                       │ hidden; no submission button
// full  │ APPROVED role                         │ All designs, all yarn codes
// admin │ ADMIN or OWNER role                   │ Full + admin features

import { db } from "./db";
import { getSession } from "./auth";
import { getCurrentTenant } from "./tenant";

export type Tier = "demo" | "full" | "admin";

export type TierInfo = {
  tier: Tier;
  /** True when the user is authenticated but their account hasn't been approved yet. */
  pendingApproval: boolean;
};

/**
 * Returns the full tier info for the current session user within a tenant.
 */
export async function getTierForUser(tenantId: string): Promise<TierInfo> {
  const session = await getSession();
  if (!session?.user.email) return { tier: "demo", pendingApproval: false };

  const tenantUser = await db.tenantUser.findUnique({
    where: {
      tenantId_email: { tenantId, email: session.user.email },
    },
    select: { role: true },
  });

  if (!tenantUser) return { tier: "demo", pendingApproval: false };

  switch (tenantUser.role) {
    case "OWNER":
    case "ADMIN":
      return { tier: "admin", pendingApproval: false };
    case "APPROVED":
      return { tier: "full", pendingApproval: false };
    case "PENDING":
      return { tier: "demo", pendingApproval: true };
    default:
      // DEMO role
      return { tier: "demo", pendingApproval: false };
  }
}

/**
 * Resolves tier for the tenant matching the current request's domain.
 * Falls back to the default tenant when no custom domain matches.
 */
export async function getDefaultTierInfo(): Promise<TierInfo> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { tier: "demo", pendingApproval: false };
  return getTierForUser(tenant.id);
}

/**
 * Returns the current session user's raw role string for the request's tenant,
 * or null if the user is not authenticated / not a tenant member.
 * Used by admin actions that need to distinguish OWNER from ADMIN.
 */
export async function getCurrentUserRole(): Promise<string | null> {
  const session = await getSession();
  if (!session?.user.email) return null;

  const tenant = await getCurrentTenant();
  if (!tenant) return null;

  const tenantUser = await db.tenantUser.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: session.user.email } },
    select: { role: true },
  });
  return tenantUser?.role ?? null;
}
