// Tier resolution — determines what a user can see for a given tenant.
//
// Tier  │ Who                                   │ What they see
// ──────┼───────────────────────────────────────┼────────────────────────────────
// demo  │ Unauthenticated, PENDING, DEMO role   │ isDemo designs only; yarn codes
//       │                                       │ hidden (shown as "Color 1" etc.)
// full  │ APPROVED role                         │ All designs, all yarn codes
// admin │ ADMIN role                            │ Full + admin features

import { db } from "./db";
import { getSession } from "./auth";

export type Tier = "demo" | "full" | "admin";

/**
 * Returns the access tier for the current session user within a tenant.
 * Falls back to "demo" for unauthenticated users or unrecognised emails.
 *
 * @param tenantId  The tenant to check membership against.
 */
export async function getTierForUser(tenantId: string): Promise<Tier> {
  const session = await getSession();
  if (!session?.user.email) return "demo";

  const tenantUser = await db.tenantUser.findUnique({
    where: {
      tenantId_email: {
        tenantId,
        email: session.user.email,
      },
    },
    select: { role: true },
  });

  if (!tenantUser) return "demo";

  switch (tenantUser.role) {
    case "ADMIN":
      return "admin";
    case "APPROVED":
      return "full";
    default:
      // PENDING and DEMO roles get demo tier
      return "demo";
  }
}
