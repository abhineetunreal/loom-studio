// Tier resolution — determines what a user can see for a given tenant.
//
// Tier  │ Who                                   │ What they see
// ──────┼───────────────────────────────────────┼────────────────────────────────
// demo  │ Unauthenticated, PENDING, DEMO role   │ isDemo designs only; yarn codes
//       │                                       │ hidden; no submission button
// full  │ APPROVED role                         │ All designs, all yarn codes
// admin │ ADMIN role                            │ Full + admin features

import { db } from "./db";
import { getSession } from "./auth";

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
 * Resolves tier for the default tenant (carpetsbazaar).
 * Used in root layout and design pages until subdomain routing is added.
 */
export async function getDefaultTierInfo(): Promise<TierInfo> {
  const tenant = await db.tenant.findUnique({
    where: { slug: process.env.DEFAULT_TENANT_SLUG ?? "carpetsbazaar" },
    select: { id: true },
  });
  if (!tenant) return { tier: "demo", pendingApproval: false };
  return getTierForUser(tenant.id);
}
