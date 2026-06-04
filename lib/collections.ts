// Collection access helpers — determines which collections an APPROVED user can see.
//
// Logic:
//   ADMIN         → null (no filter; see everything)
//   APPROVED + 0 CollectionAccess rows → null (backward-compatible; see everything)
//   APPROVED + N CollectionAccess rows → restrict to those collection IDs
//   DEMO/PENDING  → null (demo filter is applied separately via isDemo)

import { db } from "./db";
import { getSession } from "./auth";

/**
 * Returns a list of collectionId strings the current session user is restricted to,
 * or null if no restriction applies.
 *
 * Only meaningful for APPROVED-tier users; all other callers can ignore the return.
 */
export async function getCollectionAccessIds(
  tenantId: string
): Promise<string[] | null> {
  const session = await getSession();
  if (!session?.user.email) return null;

  const tenantUser = await db.tenantUser.findUnique({
    where: { tenantId_email: { tenantId, email: session.user.email } },
    select: { id: true, role: true },
  });

  if (!tenantUser || tenantUser.role !== "APPROVED") return null;

  const access = await db.collectionAccess.findMany({
    where: { tenantUserId: tenantUser.id },
    select: { collectionId: true },
  });

  if (access.length === 0) return null; // no restrictions

  return access.map((a) => a.collectionId);
}
